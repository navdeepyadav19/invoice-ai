-- Webhooks, delivered from an outbox.
--
-- The naive version — POST to the subscriber right after the update — loses
-- events. If the process dies between committing the invoice and firing the
-- request, nobody ever hears about it, and there is no record that anything was
-- missed. Retrying is impossible because the intent to notify was never stored.
--
-- The outbox pattern stores that intent in the SAME transaction as the change:
--
--   BEGIN
--     insert into invoice_events (…)          ← the change
--     insert into webhook_deliveries (…)      ← the trigger below, same txn
--   COMMIT
--                    │
--                    ▼  separately, and at its own pace
--            deliver + retry until it sticks
--
-- Either both rows exist or neither does. A delivery can then be retried for
-- hours without the original request caring.
--
-- The second reason for a trigger rather than application code: `viewed` and
-- `downloaded` are written by log_public_invoice_event, called from the public
-- share link with no session. They never pass through the API at all, so an
-- application-level hook would silently miss exactly the events that tell a
-- user their client opened the invoice.

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  url text not null,

  -- Shared with the subscriber so they can verify our signature. Shown once at
  -- creation, like an API key — but unlike an API key this one must remain
  -- recoverable, because we need it to SIGN. See the note in lib/webhooks/sign.ts.
  secret text not null,

  -- Which event types to send. Empty means all.
  events text[] not null default '{}',
  active boolean not null default true,

  -- An endpoint that has been failing for days is almost always gone for good.
  -- Counting lets us stop hammering it and tell the owner.
  failure_count integer not null default 0,
  disabled_at timestamptz,

  created_at timestamptz not null default now(),

  -- https only, enforced here as well as in the application. A plaintext
  -- webhook leaks invoice totals and client names to anyone on the path.
  constraint webhook_endpoints_https check (url like 'https://%')
);

create index webhook_endpoints_owner_idx on public.webhook_endpoints (owner_id);

alter table public.webhook_endpoints enable row level security;

create policy "own webhook endpoints"
  on public.webhook_endpoints
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------

create table public.webhook_deliveries (
  -- Sent as the `webhook-id` header. Subscribers use it to deduplicate, which
  -- matters because delivery is at-least-once.
  id uuid primary key default gen_random_uuid(),
  endpoint_id uuid not null references public.webhook_endpoints (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,

  event_type text not null,
  payload jsonb not null,

  attempt integer not null default 0,
  status text not null default 'pending',

  next_attempt_at timestamptz not null default now(),
  response_code integer,
  -- Truncated in the application. A subscriber's error page can be a megabyte
  -- of HTML, and storing it would make this table the biggest one we have.
  last_error text,

  created_at timestamptz not null default now(),

  constraint webhook_deliveries_status
    check (status in ('pending', 'succeeded', 'failed', 'dead'))
);

-- The query the cron runs: "what is due?". Partial, because succeeded rows are
-- the overwhelming majority and never need scanning.
create index webhook_deliveries_due_idx
  on public.webhook_deliveries (next_attempt_at)
  where status = 'pending';

create index webhook_deliveries_endpoint_idx
  on public.webhook_deliveries (endpoint_id, created_at desc);

alter table public.webhook_deliveries enable row level security;

create policy "own webhook deliveries"
  on public.webhook_deliveries
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- The outbox trigger
--
-- Runs inside the same transaction as the invoice_events insert. If this raises,
-- the state change rolls back too — which is the correct trade: an event nobody
-- can be told about is worse than an operation that visibly failed.
-- ---------------------------------------------------------------------------

create or replace function public.enqueue_webhook_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_event_name text;
  v_payload jsonb;
begin
  -- The stored enum says `sent`; integrators are told `invoice.issued`. The
  -- rename happens here so historical rows never have to be rewritten, and
  -- lib/api/serialize.ts uses the same mapping for the events endpoint.
  v_event_name := case new.type
    when 'sent' then 'invoice.issued'
    else 'invoice.' || new.type::text
  end;

  select i.owner_id,
         jsonb_build_object(
           'id', new.id,
           'type', v_event_name,
           'created_at', new.created_at,
           'data', jsonb_build_object(
             'invoice_id', i.id,
             'invoice_number', i.invoice_number,
             'status', i.status,
             'client_id', i.client_id,
             'total_paise', round(i.total * 100),
             'currency', i.currency,
             'issue_date', i.issue_date,
             'due_date', i.due_date
           )
         )
    into v_owner_id, v_payload
  from public.invoices i
  where i.id = new.invoice_id;

  if v_owner_id is null then
    return new;
  end if;

  insert into public.webhook_deliveries (endpoint_id, owner_id, event_type, payload)
  select e.id, v_owner_id, v_event_name, v_payload
  from public.webhook_endpoints e
  where e.owner_id = v_owner_id
    and e.active
    and e.disabled_at is null
    -- An empty events array means "everything", so a subscriber does not have
    -- to re-register every time we add an event type.
    and (cardinality(e.events) = 0 or v_event_name = any (e.events));

  return new;
end;
$$;

create trigger invoice_events_enqueue_webhooks
  after insert on public.invoice_events
  for each row
  execute function public.enqueue_webhook_deliveries();

-- ---------------------------------------------------------------------------
-- Delivery worker support
--
-- The worker needs to read deliveries across ALL owners, which no user token
-- can do. These run as definer and are revoked from anon and authenticated:
-- only the service role (the cron route) can reach them.
-- ---------------------------------------------------------------------------

create or replace function public.claim_due_webhook_deliveries(p_limit integer default 50)
returns setof public.webhook_deliveries
language sql
security definer
set search_path = public
as $$
  -- SKIP LOCKED so two cron invocations overlapping never deliver the same row
  -- twice. Without it, a slow run and its successor double-send.
  update public.webhook_deliveries d
  set attempt = d.attempt + 1,
      next_attempt_at = now() + interval '1 hour'
  where d.id in (
    select id from public.webhook_deliveries
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at
    limit p_limit
    for update skip locked
  )
  returning d.*;
$$;

revoke all on function public.claim_due_webhook_deliveries(integer) from public, anon, authenticated;

create or replace function public.finish_webhook_delivery(
  p_id uuid,
  p_status text,
  p_response_code integer,
  p_error text,
  p_next_attempt_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.webhook_deliveries
  set status = p_status,
      response_code = p_response_code,
      last_error = left(p_error, 500),
      next_attempt_at = coalesce(p_next_attempt_at, next_attempt_at)
  where id = p_id;

  if p_status = 'succeeded' then
    update public.webhook_endpoints
    set failure_count = 0
    where id = (select endpoint_id from public.webhook_deliveries where id = p_id);
  elsif p_status = 'dead' then
    update public.webhook_endpoints e
    set failure_count = e.failure_count + 1,
        -- 20 dead deliveries is days of continuous failure. Past that the
        -- endpoint is gone, and continuing to try is noise for both sides.
        disabled_at = case when e.failure_count + 1 >= 20 then now() else e.disabled_at end
    where e.id = (select endpoint_id from public.webhook_deliveries where id = p_id);
  end if;
end;
$$;

revoke all on function public.finish_webhook_delivery(uuid, text, integer, text, timestamptz)
  from public, anon, authenticated;

comment on table public.webhook_deliveries is
  'Outbox. Rows are written in the same transaction as the invoice_event that caused them.';
