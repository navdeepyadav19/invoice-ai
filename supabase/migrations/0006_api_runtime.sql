-- Idempotency and audit: the two tables that make retries safe and traceable.
--
-- The failure idempotency prevents, concretely:
--
--   1. SDK sends POST /invoices/{id}/issue
--   2. we assign INV/26-27/0042 and commit
--   3. the response is lost — flaky wifi, a proxy timeout, a lambda freeze
--   4. the SDK, seeing no response, retries
--
-- Without a key, step 4 assigns INV/26-27/0043 and 0042 becomes a number that
-- exists in the counter but on no invoice. GST requires the series to be
-- consecutive, so that gap is a compliance problem, not just a bug.
--
-- issue_invoice() in 0004 already makes *that specific* call safe. This table
-- generalises it to every write: sending an email twice, marking paid twice,
-- creating two drafts from one retried POST.

create table public.idempotency_keys (
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- Client-chosen. Scoped per owner so two tenants picking "1" don't collide.
  key text not null,

  method text not null,
  path text not null,

  -- SHA-256 of method + path + body. If a client reuses a key with a DIFFERENT
  -- body, that is a bug on their side — almost always a key generated once and
  -- reused in a loop — and silently replaying the first response would hide it.
  -- We return 422 instead.
  request_hash text not null,

  -- in_progress: claimed, handler still running. A concurrent retry gets 409.
  -- completed:   response stored below, replayed verbatim.
  state text not null default 'in_progress',

  response_status integer,
  response_body jsonb,

  created_at timestamptz not null default now(),
  -- 24h is the window a sane client retries within. Keeping them forever would
  -- grow without bound and make a key reused next year replay a stale answer.
  expires_at timestamptz not null default now() + interval '24 hours',

  constraint idempotency_keys_pkey primary key (owner_id, key),
  constraint idempotency_keys_state check (state in ('in_progress', 'completed'))
);

create index idempotency_keys_expiry_idx on public.idempotency_keys (expires_at);

alter table public.idempotency_keys enable row level security;

create policy "own idempotency keys"
  on public.idempotency_keys
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Claim a key.
--
-- The whole operation has to be one atomic step, or two simultaneous retries
-- both see "no row" and both run the handler — which is the exact race the
-- table exists to prevent.
--
-- INSERT ... ON CONFLICT DO NOTHING is that step: exactly one caller inserts.
-- The loser reads the existing row and is told to replay or back off.
--
-- Returns: ('claimed', null, null)         → you own it, run the handler
--          ('replay', status, body)        → completed before, here's the answer
--          ('in_progress', null, null)     → someone else is running it → 409
--          ('mismatch', null, null)        → same key, different body → 422
-- ---------------------------------------------------------------------------

create or replace function public.claim_idempotency_key(
  p_key text,
  p_method text,
  p_path text,
  p_request_hash text
)
returns table (outcome text, response_status integer, response_body jsonb)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_existing public.idempotency_keys%rowtype;
begin
  insert into public.idempotency_keys (owner_id, key, method, path, request_hash)
  values (auth.uid(), p_key, p_method, p_path, p_request_hash)
  on conflict (owner_id, key) do nothing;

  if found then
    return query select 'claimed'::text, null::integer, null::jsonb;
    return;
  end if;

  select * into v_existing
  from public.idempotency_keys
  where owner_id = auth.uid() and key = p_key;

  -- Expired but not yet swept: treat it as free and take it over.
  if v_existing.expires_at <= now() then
    update public.idempotency_keys
    set method = p_method, path = p_path, request_hash = p_request_hash,
        state = 'in_progress', response_status = null, response_body = null,
        created_at = now(), expires_at = now() + interval '24 hours'
    where owner_id = auth.uid() and key = p_key;

    return query select 'claimed'::text, null::integer, null::jsonb;
    return;
  end if;

  if v_existing.request_hash <> p_request_hash then
    return query select 'mismatch'::text, null::integer, null::jsonb;
    return;
  end if;

  if v_existing.state = 'completed' then
    return query select 'replay'::text, v_existing.response_status, v_existing.response_body;
    return;
  end if;

  return query select 'in_progress'::text, null::integer, null::jsonb;
end;
$$;

revoke all on function public.claim_idempotency_key(text, text, text, text) from public;
revoke execute on function public.claim_idempotency_key(text, text, text, text) from anon;
grant execute on function public.claim_idempotency_key(text, text, text, text) to authenticated;

create or replace function public.complete_idempotency_key(
  p_key text,
  p_status integer,
  p_body jsonb
)
returns void
language sql
security invoker
set search_path = public
as $$
  update public.idempotency_keys
  set state = 'completed', response_status = p_status, response_body = p_body
  where owner_id = auth.uid() and key = p_key;
$$;

revoke all on function public.complete_idempotency_key(text, integer, jsonb) from public;
revoke execute on function public.complete_idempotency_key(text, integer, jsonb) from anon;
grant execute on function public.complete_idempotency_key(text, integer, jsonb) to authenticated;

-- A handler that threw must not leave a key claimed forever — the client's
-- retry would get 409 until the 24h expiry. Releasing lets them try again.
create or replace function public.release_idempotency_key(p_key text)
returns void
language sql
security invoker
set search_path = public
as $$
  delete from public.idempotency_keys
  where owner_id = auth.uid() and key = p_key and state = 'in_progress';
$$;

revoke all on function public.release_idempotency_key(text) from public;
revoke execute on function public.release_idempotency_key(text) from anon;
grant execute on function public.release_idempotency_key(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log
--
-- "Which app issued this invoice?" must have an answer. invoice_events records
-- state changes but not reads, and not the credential behind them.
-- ---------------------------------------------------------------------------

create table public.api_requests (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  owner_id uuid not null references auth.users (id) on delete cascade,

  via text not null,
  api_key_id uuid references public.api_keys (id) on delete set null,
  client_id text,

  method text not null,
  route text not null,
  status integer not null,
  duration_ms integer not null,
  idempotency_key text,

  -- Hashed, not stored raw. An IP is personal data under GDPR and we only ever
  -- need to answer "was this the same caller?", which a hash answers fine.
  ip_hash text,

  created_at timestamptz not null default now(),

  constraint api_requests_via check (via in ('session', 'api_key', 'oauth'))
);

create index api_requests_owner_idx on public.api_requests (owner_id, created_at desc);
create index api_requests_created_idx on public.api_requests (created_at);

alter table public.api_requests enable row level security;

-- Readable by its owner, never writable by them: an audit log a caller can edit
-- is not an audit log. Rows are inserted by the API using the caller's own
-- token, so there is an explicit insert policy and no update or delete policy.
create policy "own api requests"
  on public.api_requests
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy "insert own api requests"
  on public.api_requests
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

comment on table public.api_requests is
  'One row per /api/v1 request. Append-only by policy: owners can read but never modify.';

-- ---------------------------------------------------------------------------
-- Housekeeping
--
-- Not scheduled here. pg_cron is commented out in 0001 for the same reason, and
-- a cron job that appears without anyone deciding to run it is a surprise.
-- Call these from the Vercel cron route, or schedule them deliberately.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_api_runtime(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.idempotency_keys where expires_at < now();
  get diagnostics v_deleted = row_count;

  delete from public.api_requests where created_at < now() - make_interval(days => p_days);

  return v_deleted;
end;
$$;

revoke all on function public.cleanup_api_runtime(integer) from public;
revoke execute on function public.cleanup_api_runtime(integer) from anon, authenticated;
