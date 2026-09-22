-- CLI login: an RFC 8628-style device authorization grant.
--
-- `invoice-ai login` has no browser session and must never see a password. So,
-- like `gh auth login` and `vercel login`, the terminal and the browser meet in
-- the middle:
--
--   CLI      POST /api/cli/device  → device_code (secret, kept by the CLI)
--                                   + user_code   (short, shown to the human)
--   Browser  /cli/authorize?code=WXYZ-2345, signed in → Authorize
--   CLI      POST /api/cli/token {device_code} every 5s → the API key, once
--
-- Two things this table deliberately does NOT hold:
--
--   * the device code itself — only hex(sha256(device_code)). A leaked table is
--     not a set of codes anyone can poll with.
--   * the API key. Nothing is minted at approval time. Approval records WHO
--     approved and WHICH scopes; the key is generated on the first successful
--     poll, inserted as that owner (RLS applies, see lib/auth/create-api-key.ts),
--     and its plaintext exists only in that one HTTP response.
--
-- Lifecycle (status):
--
--   pending ──approve──▶ approved ──first poll──▶ consumed
--      │                    │
--      ├──deny──▶ denied    └──(10 min)──▶ expired
--      └──(10 min)──▶ expired
--
-- Written to be re-runnable (if not exists / create or replace / drop ... if
-- exists), like 0012.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------

do $$
begin
  create type public.cli_device_status as enum ('pending', 'approved', 'denied', 'consumed', 'expired');
exception
  when duplicate_object then null;
end
$$;

create table if not exists public.cli_device_codes (
  id uuid primary key default gen_random_uuid(),

  -- hex(sha256(device_code)). The raw code only ever exists on the CLI's machine.
  device_code_hash text not null,

  -- Normalised: 8 chars from BCDFGHJKLMNPQRSTVWXZ23456789, no dash. The dash in
  -- "WXYZ-2345" is presentation only (lib/cli-auth/device.ts).
  user_code text not null,

  -- Self-reported by the CLI (hostname, platform). Shown on the consent screen
  -- and used to name the key; never trusted for anything else.
  client_name text not null,
  client_os text,

  status public.cli_device_status not null default 'pending',

  -- Set on approve/deny. Null while pending.
  owner_id uuid references auth.users (id) on delete cascade,
  scopes text[] not null default '{}',

  -- The key minted on the first successful poll. Kept so Settings → API keys
  -- (and an audit) can tell which login produced which key.
  api_key_id uuid references public.api_keys (id) on delete set null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  approved_at timestamptz,
  consumed_at timestamptz,
  last_polled_at timestamptz,

  constraint cli_device_codes_hash_shape check (device_code_hash ~ '^[0-9a-f]{64}$'),
  constraint cli_device_codes_user_code_shape check (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$'),
  constraint cli_device_codes_client_name_len check (char_length(client_name) between 1 and 64),
  constraint cli_device_codes_client_os_len check (client_os is null or char_length(client_os) <= 64),
  -- An approval without an owner, or with nothing granted, is a bug upstream.
  constraint cli_device_codes_approved_has_owner check (
    status not in ('approved', 'consumed') or (owner_id is not null and cardinality(scopes) > 0)
  )
);

create unique index if not exists cli_device_codes_device_code_hash_key
  on public.cli_device_codes (device_code_hash);

-- A user code is short (28^8 ≈ 3.8e11), so it is only unique among codes a
-- human might still type. Finished rows free their code for reuse.
create unique index if not exists cli_device_codes_pending_user_code_key
  on public.cli_device_codes (user_code)
  where status = 'pending';

-- Serves the global creation cap and the sweep in cli_device_start.
create index if not exists cli_device_codes_created_idx
  on public.cli_device_codes (created_at);

-- RLS on with no policies: nothing reaches this table from a browser session or
-- an anon PostgREST call. Every access goes through the functions below.
alter table public.cli_device_codes enable row level security;
revoke all on table public.cli_device_codes from anon, authenticated;

comment on table public.cli_device_codes is
  'CLI device-flow logins (RFC 8628). Stores sha256 of the device code, never the code, and never an API key.';

-- ---------------------------------------------------------------------------
-- 2. cli_device_start — POST /api/cli/device
--
-- Open to anon: the CLI has no credentials yet, that is the point. The route
-- rate-limits per IP; because the publishable key is public and this can be
-- called straight through PostgREST, the function also caps creation globally
-- and sweeps old rows, so it cannot be used to grow the table without bound.
--
-- Returns 'created' | 'collision' (user code in use — retry with a new one) |
-- 'rate_limited'.
-- ---------------------------------------------------------------------------

create or replace function public.cli_device_start(
  p_device_code_hash text,
  p_user_code text,
  p_client_name text,
  p_client_os text
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_device_code_hash is null or p_device_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Malformed device code hash';
  end if;

  if p_user_code is null or p_user_code !~ '^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$' then
    raise exception 'Malformed user code';
  end if;

  -- Housekeeping, cheap thanks to the created_at index. Finished or abandoned
  -- rows older than a day carry no information worth keeping (the key itself,
  -- if one was minted, lives on in api_keys).
  delete from public.cli_device_codes where created_at < now() - interval '1 day';

  update public.cli_device_codes
  set status = 'expired'
  where status in ('pending', 'approved') and expires_at <= now();

  if (
    select count(*) from public.cli_device_codes
    where created_at > now() - interval '1 minute'
  ) >= 600 then
    return 'rate_limited';
  end if;

  begin
    insert into public.cli_device_codes (device_code_hash, user_code, client_name, client_os)
    values (
      p_device_code_hash,
      p_user_code,
      coalesce(nullif(left(trim(p_client_name), 64), ''), 'Unknown device'),
      nullif(left(trim(coalesce(p_client_os, '')), 64), '')
    );
  exception
    when unique_violation then
      return 'collision';
  end;

  return 'created';
end;
$$;

revoke all on function public.cli_device_start(text, text, text, text) from public;
grant execute on function public.cli_device_start(text, text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. cli_device_lookup — the consent screen reads what it is approving
--
-- Signed-in users only, and only codes that are still pending and unexpired: a
-- finished code reveals nothing. Returns no row when there is nothing to show.
-- ---------------------------------------------------------------------------

create or replace function public.cli_device_lookup(p_user_code text)
returns table (
  client_name text,
  client_os text,
  created_at timestamptz,
  expires_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select d.client_name, d.client_os, d.created_at, d.expires_at
  from public.cli_device_codes d
  where auth.uid() is not null
    and d.user_code = p_user_code
    and d.status = 'pending'
    and d.expires_at > now();
$$;

revoke all on function public.cli_device_lookup(text) from public;
revoke execute on function public.cli_device_lookup(text) from anon;
grant execute on function public.cli_device_lookup(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. cli_device_decide — Authorize / Deny
--
-- The caller becomes the owner. Guests are refused for the same reason the
-- settings page refuses them a key: cleanup_stale_guests deletes them after 30
-- days, and a key for a deleted owner is a credential pointing at nothing.
--
-- Returns 'approved' | 'denied' | 'expired' | 'not_found' | 'guest'.
-- ---------------------------------------------------------------------------

create or replace function public.cli_device_decide(
  p_user_code text,
  p_approve boolean,
  p_scopes text[]
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.cli_device_codes%rowtype;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    return 'guest';
  end if;

  if p_approve and coalesce(cardinality(p_scopes), 0) = 0 then
    raise exception 'Approving requires at least one scope';
  end if;

  -- Row lock: two tabs clicking Authorize and Deny at once resolve to exactly
  -- one decision.
  select * into v_row
  from public.cli_device_codes
  where user_code = p_user_code and status = 'pending'
  for update;

  if not found then
    return 'not_found';
  end if;

  if v_row.expires_at <= now() then
    update public.cli_device_codes set status = 'expired' where id = v_row.id;
    return 'expired';
  end if;

  if p_approve then
    update public.cli_device_codes
    set status = 'approved', owner_id = v_uid, scopes = p_scopes, approved_at = now()
    where id = v_row.id;
    return 'approved';
  end if;

  update public.cli_device_codes
  set status = 'denied', owner_id = v_uid, approved_at = now()
  where id = v_row.id;
  return 'denied';
end;
$$;

revoke all on function public.cli_device_decide(text, boolean, text[]) from public;
revoke execute on function public.cli_device_decide(text, boolean, text[]) from anon;
grant execute on function public.cli_device_decide(text, boolean, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. cli_device_poll — POST /api/cli/token
--
-- Open to anon; possession of the device code is the credential. Outcomes map
-- one-to-one onto RFC 8628 §3.5 error codes, plus 'approved':
--
--   authorization_pending   still waiting for the human
--   slow_down               polled again within 4s (interval 5s, 1s of grace
--                           for network jitter); the CLI should add 5s
--   access_denied           the human clicked Deny
--   expired_token           10 minutes passed
--   invalid_grant           unknown code, or already exchanged for a key
--   approved                THIS call won the row: status is now 'consumed',
--                           and owner_id/scopes/client_name are returned so the
--                           app can mint the key as that owner
--
-- The FOR UPDATE lock is what makes the key single-issue: two concurrent polls
-- serialise on the row, the first flips approved → consumed, and the second
-- sees 'consumed' and gets invalid_grant. There is no window for a double mint.
-- ---------------------------------------------------------------------------

create or replace function public.cli_device_poll(p_device_code_hash text)
returns table (
  outcome text,
  owner_id uuid,
  scopes text[],
  client_name text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- ^ The OUT columns (owner_id, scopes, client_name) share names with table
-- columns; table references below are qualified, and this makes any slip
-- resolve to the column rather than silently to the OUT variable.
declare
  v_row public.cli_device_codes%rowtype;
begin
  if p_device_code_hash is null or p_device_code_hash !~ '^[0-9a-f]{64}$' then
    return query select 'invalid_grant'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  select * into v_row
  from public.cli_device_codes d
  where d.device_code_hash = p_device_code_hash
  for update;

  if not found then
    return query select 'invalid_grant'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_row.status = 'consumed' then
    return query select 'invalid_grant'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_row.status = 'denied' then
    return query select 'access_denied'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_row.status = 'expired' or v_row.expires_at <= now() then
    update public.cli_device_codes set status = 'expired' where id = v_row.id;
    return query select 'expired_token'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_row.status = 'approved' then
    update public.cli_device_codes
    set status = 'consumed', consumed_at = now(), last_polled_at = now()
    where id = v_row.id;
    return query select 'approved'::text, v_row.owner_id, v_row.scopes, v_row.client_name;
    return;
  end if;

  -- pending
  if v_row.last_polled_at is not null and v_row.last_polled_at > now() - interval '4 seconds' then
    update public.cli_device_codes set last_polled_at = now() where id = v_row.id;
    return query select 'slow_down'::text, null::uuid, null::text[], null::text;
    return;
  end if;

  update public.cli_device_codes set last_polled_at = now() where id = v_row.id;
  return query select 'authorization_pending'::text, null::uuid, null::text[], null::text;
end;
$$;

revoke all on function public.cli_device_poll(text) from public;
grant execute on function public.cli_device_poll(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. cli_device_attach_key / cli_device_release — after the mint
--
-- Both run as the OWNER (the app calls them with the same minted user token it
-- inserted the key with), and both check it: nobody else can touch the row.
--
--   attach   record which api_keys row this login produced.
--   release  the mint failed after the poll consumed the row; put it back to
--            'approved' so the CLI's next poll can try again. Only a consumed
--            row with no key attached can be released, so a successful login
--            can never be re-opened.
-- ---------------------------------------------------------------------------

create or replace function public.cli_device_attach_key(p_device_code_hash text, p_api_key_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.cli_device_codes d
  set api_key_id = p_api_key_id
  where d.device_code_hash = p_device_code_hash
    and d.status = 'consumed'
    and d.owner_id = v_uid
    and d.api_key_id is null
    and exists (select 1 from public.api_keys k where k.id = p_api_key_id and k.owner_id = v_uid);

  return found;
end;
$$;

revoke all on function public.cli_device_attach_key(text, uuid) from public;
revoke execute on function public.cli_device_attach_key(text, uuid) from anon;
grant execute on function public.cli_device_attach_key(text, uuid) to authenticated;

create or replace function public.cli_device_release(p_device_code_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.cli_device_codes d
  set status = 'approved', consumed_at = null
  where d.device_code_hash = p_device_code_hash
    and d.status = 'consumed'
    and d.owner_id = v_uid
    and d.api_key_id is null
    and d.expires_at > now();

  return found;
end;
$$;

revoke all on function public.cli_device_release(text) from public;
revoke execute on function public.cli_device_release(text) from anon;
grant execute on function public.cli_device_release(text) to authenticated;
