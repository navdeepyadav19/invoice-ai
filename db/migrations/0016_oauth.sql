-- OAuth 2.1: the data model behind "Connect Claude / ChatGPT / Cursor".
--
-- An MCP client (Claude.ai, ChatGPT, an IDE) must act for a user without ever
-- seeing their password or an API key they pasted somewhere. OAuth 2.1 is the
-- standard answer, and the MCP spec requires it. The whole dance:
--
--   Client   discovers us via /.well-known/oauth-authorization-server
--   Client   registers: POST /oauth/register (DCR, RFC 7591) → client_id
--            …or skips registration: its client_id IS an https URL to a JSON
--            metadata document we fetch and cache (CIMD)
--   Browser  /oauth/authorize?client_id&redirect_uri&code_challenge&scope…
--            user signs in, ticks scopes, clicks Approve
--            → 303 to redirect_uri?code=inv_oac_…&state&iss
--   Client   POST /oauth/token  grant_type=authorization_code + code_verifier
--            → access token (inv_oat_, 1 hour) + refresh token (inv_ort_, 30 days)
--   Client   POST /oauth/token  grant_type=refresh_token
--            → a NEW access + refresh pair; the old refresh token is spent
--
-- Four tables, one per noun:
--
--   oauth_clients              who is asking (a registered or cached app)
--   oauth_grants               the "connected app": user U allowed client C
--                              scopes S. What Settings → AI assistants lists
--                              and what Revoke kills.
--   oauth_authorization_codes  the one-time ticket between Approve and /token
--   oauth_tokens               access and refresh tokens
--
-- What these tables deliberately do NOT hold: any usable secret. Codes, tokens
-- and client secrets are stored as hex(HMAC-SHA256(subkey, value)) — the same
-- peppered-hash idea as api_keys (0005), with a subkey derived from
-- API_KEY_PEPPER. A leaked dump is not a set of working credentials.
--
-- Token families. Every token minted from one authorization code shares a
-- family_id, which is the code's own id. Refresh tokens rotate on every use
-- (OAuth 2.1 §4.3.1 for public clients): the old one is marked used_at, the new
-- one points back at it with parent_id. If a used refresh token is ever
-- presented again, two parties hold the same lineage — the client and a thief —
-- and we cannot tell which is which, so the whole family is revoked. The same
-- applies to a replayed authorization code (RFC 6749 §4.1.2).
--
--   code ──redeem────▶ access₁ + refresh₁ ──rotate──▶ access₂ + refresh₂ ──▶ …
--     │                                │
--     └─ replayed? revoke family       └─ refresh₁ replayed? revoke family
--
-- Effective permissions are always token.scopes ∩ grant.scopes: narrowing a
-- grant (re-consenting with fewer boxes ticked) narrows every live token
-- without touching them, and revoking the grant kills them all.
--
-- Access path. Every table has RLS on. Only oauth_grants has a policy (owners
-- can SELECT their own rows); everything else, including every write, goes
-- through the SECURITY DEFINER functions below, each with explicit grants.
-- /token, /register and /revoke run as anon — a client authenticates with what
-- it holds (a code, a refresh token, a client secret), not with a session.
-- Approve, Revoke and the list in Settings run as authenticated.
--
-- Written to be re-runnable (if not exists / create or replace), like 0013.

-- ---------------------------------------------------------------------------
-- 1. oauth_clients
--
-- Two kinds of row share this table, because everything downstream (grants,
-- the consent screen, client authentication) wants one place to look a client
-- up by its client_id:
--
--   dcr   Dynamic Client Registration. We mint client_id = oc_<24 base62>.
--         Anyone can register, so the name and URIs are self-asserted and the
--         consent screen labels the app "Unverified". Rows nobody ever
--         authorized are swept after 30 days.
--   cimd  Client ID Metadata Document. client_id is an https URL the client
--         controls; the app fetches it and caches the result here until
--         metadata_expires_at. The domain in the URL is the identity, which is
--         why the consent screen can say "Verified domain". CIMD clients are
--         always public clients (no secret): a secret in a public document
--         would not be a secret.
--
-- logo_uri is only ever set for cimd rows. A DCR logo is an attacker-chosen
-- image on the consent screen, so registration does not accept one.
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_clients (
  id uuid primary key default gen_random_uuid(),

  -- What the client sends on the wire. dcr: oc_<24 base62>. cimd: the URL.
  client_id text not null,
  kind text not null,

  client_name text not null,
  client_uri text,
  logo_uri text,

  -- Matched by the app (lib/oauth/redirect-uri.ts), not here: RFC 8252 lets a
  -- loopback redirect use any port, which an equality check can't express.
  redirect_uris text[] not null,
  grant_types text[] not null default '{authorization_code,refresh_token}',
  token_endpoint_auth_method text not null,

  -- hex(HMAC) of the inv_ocs_ secret. Null exactly when the client is public.
  client_secret_hash text,

  -- The registration request or fetched document, kept for debugging and so a
  -- later PR can read a field without a migration. Never trusted on its own.
  metadata jsonb,
  -- cimd only: refetch the document after this.
  metadata_expires_at timestamptz,

  created_at timestamptz not null default now(),
  last_used_at timestamptz,

  constraint oauth_clients_kind check (kind in ('dcr', 'cimd')),
  constraint oauth_clients_client_id_len check (char_length(client_id) <= 2048),
  constraint oauth_clients_client_id_shape check (
    (kind = 'dcr' and client_id ~ '^oc_[0-9A-Za-z]{24}$')
    or (kind = 'cimd' and client_id ~ '^https://')
  ),
  constraint oauth_clients_name_len check (char_length(client_name) between 1 and 100),
  constraint oauth_clients_client_uri_len check (client_uri is null or char_length(client_uri) <= 2048),
  constraint oauth_clients_logo_uri_len check (logo_uri is null or char_length(logo_uri) <= 2048),
  constraint oauth_clients_logo_cimd_only check (kind = 'cimd' or logo_uri is null),
  constraint oauth_clients_redirect_uris_count check (cardinality(redirect_uris) between 1 and 10),
  constraint oauth_clients_grant_types check (
    cardinality(grant_types) > 0
    and grant_types <@ array['authorization_code', 'refresh_token']
  ),
  constraint oauth_clients_auth_method check (
    token_endpoint_auth_method in ('none', 'client_secret_basic', 'client_secret_post')
  ),
  constraint oauth_clients_secret_iff_confidential check (
    (token_endpoint_auth_method = 'none') = (client_secret_hash is null)
  ),
  constraint oauth_clients_secret_hash_shape check (
    client_secret_hash is null or client_secret_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint oauth_clients_cimd_is_public check (kind = 'dcr' or token_endpoint_auth_method = 'none'),
  constraint oauth_clients_cimd_has_expiry check ((kind = 'cimd') = (metadata_expires_at is not null))
);

create unique index if not exists oauth_clients_client_id_key
  on public.oauth_clients (client_id);

-- Serves the global registration cap and the sweep in oauth_register_client.
create index if not exists oauth_clients_created_idx
  on public.oauth_clients (created_at);

alter table public.oauth_clients enable row level security;
revoke all on table public.oauth_clients from anon, authenticated;

comment on table public.oauth_clients is
  'OAuth clients: DCR registrations (RFC 7591) and cached CIMD documents. Secrets are stored as HMAC only.';

-- ---------------------------------------------------------------------------
-- 2. oauth_grants
--
-- One ACTIVE grant per (user, client). Approving the same app again updates
-- the existing grant's scopes instead of stacking a second row, so Settings
-- shows one line per connected app. A revoked grant stays as history; a later
-- approval starts a fresh row.
--
-- The only OAuth table with a policy: owners may read their own rows. There is
-- no insert/update/delete policy — approving and revoking go through
-- oauth_authorize and oauth_revoke_grant, which also handle the tokens.
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  client_id uuid not null references public.oauth_clients (id) on delete cascade,

  -- The ceiling for every token under this grant (effective = token ∩ grant).
  scopes text[] not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Throttled to once a minute by oauth_touch_grant.
  last_used_at timestamptz,
  revoked_at timestamptz,

  constraint oauth_grants_scopes_not_empty check (cardinality(scopes) > 0)
);

create unique index if not exists oauth_grants_active_key
  on public.oauth_grants (owner_id, client_id)
  where revoked_at is null;

-- The sweep asks "does this client have any grant?"; the FK cascade asks too.
create index if not exists oauth_grants_client_idx
  on public.oauth_grants (client_id);

alter table public.oauth_grants enable row level security;

-- 0000 gives `authenticated` full DML on every new public table by default.
-- Take it all back and hand out exactly SELECT, which the policy then filters.
revoke all on table public.oauth_grants from anon, authenticated;
grant select on table public.oauth_grants to authenticated;

drop policy if exists "own oauth grants" on public.oauth_grants;
create policy "own oauth grants"
  on public.oauth_grants
  for select
  to authenticated
  using (owner_id = (select app.uid()));

comment on table public.oauth_grants is
  'Connected apps: one active grant per (owner, client). Revoking it revokes every token under it.';

-- ---------------------------------------------------------------------------
-- 3. oauth_authorization_codes
--
-- The short-lived, single-use ticket handed to the client's redirect_uri. It
-- carries everything /token must check: the PKCE challenge (S256 only — OAuth
-- 2.1 drops "plain"), the exact redirect_uri, and the resource (audience) the
-- tokens will be bound to.
--
-- Its id doubles as the token family id. There is deliberately no foreign key
-- from oauth_tokens.family_id back here: codes are swept after a day, refresh
-- tokens live for 30.
--
-- consumed_at is set by the first redemption attempt that names the right
-- code and client, successful or not. replayed_at records the first time a
-- consumed code was presented again — the theft signal that revoked its
-- family — so an investigation can see it on the code itself.
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),

  code_hash text not null,

  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  -- Denormalised from the grant: /token checks the presenting client without
  -- a join, and the row reads on its own in an investigation.
  client_id uuid not null references public.oauth_clients (id) on delete cascade,
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,

  redirect_uri text not null,
  code_challenge text not null,
  code_challenge_method text not null default 'S256',
  scopes text[] not null,
  resource text not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  consumed_at timestamptz,
  replayed_at timestamptz,

  constraint oauth_codes_hash_shape check (code_hash ~ '^[0-9a-f]{64}$'),
  -- base64url(sha256(verifier)) without padding is always 43 characters.
  constraint oauth_codes_challenge_shape check (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
  constraint oauth_codes_challenge_method check (code_challenge_method = 'S256'),
  constraint oauth_codes_scopes_not_empty check (cardinality(scopes) > 0),
  constraint oauth_codes_redirect_uri_len check (char_length(redirect_uri) between 1 and 2048),
  constraint oauth_codes_resource_len check (char_length(resource) between 1 and 2048)
);

create unique index if not exists oauth_authorization_codes_code_hash_key
  on public.oauth_authorization_codes (code_hash);

create index if not exists oauth_authorization_codes_created_idx
  on public.oauth_authorization_codes (created_at);

create index if not exists oauth_authorization_codes_grant_idx
  on public.oauth_authorization_codes (grant_id);

alter table public.oauth_authorization_codes enable row level security;
revoke all on table public.oauth_authorization_codes from anon, authenticated;

comment on table public.oauth_authorization_codes is
  'Single-use, 5-minute OAuth authorization codes (PKCE S256). Stores HMAC of the code, never the code. id = token family id.';

-- ---------------------------------------------------------------------------
-- 4. oauth_tokens
--
-- Access and refresh tokens in one table: they share every column, and the
-- family operations (revoke all, find by grant) want both kinds at once.
--
--   family_id  the authorization code this lineage started from
--   parent_id  the refresh token this one was rotated from (null for the first
--              pair). A lineage pointer, not a constraint: the sweep deletes
--              old parents while their children are still alive.
--   resource   the audience (RFC 8707): an MCP token is refused on /api/v1 and
--              vice versa. Copied from the code, never chosen at refresh time.
--   used_at    refresh tokens only: set when rotated. Seeing a used token
--              again is the theft signal.
-- ---------------------------------------------------------------------------

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),

  token_hash text not null,
  kind text not null,

  grant_id uuid not null references public.oauth_grants (id) on delete cascade,
  family_id uuid not null,
  parent_id uuid,

  scopes text[] not null,
  resource text not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,

  constraint oauth_tokens_kind check (kind in ('access', 'refresh')),
  constraint oauth_tokens_hash_shape check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint oauth_tokens_scopes_not_empty check (cardinality(scopes) > 0),
  constraint oauth_tokens_used_refresh_only check (kind = 'refresh' or used_at is null)
);

create unique index if not exists oauth_tokens_token_hash_key
  on public.oauth_tokens (token_hash);

create index if not exists oauth_tokens_family_idx on public.oauth_tokens (family_id);
create index if not exists oauth_tokens_grant_idx on public.oauth_tokens (grant_id);
create index if not exists oauth_tokens_expires_idx on public.oauth_tokens (expires_at);

alter table public.oauth_tokens enable row level security;
revoke all on table public.oauth_tokens from anon, authenticated;

comment on table public.oauth_tokens is
  'OAuth access (1 h) and refresh (30 d, rotated on use) tokens. Stores HMAC of the token, never the token.';

-- ---------------------------------------------------------------------------
-- 5. oauth_register_client — POST /oauth/register (RFC 7591)
--
-- Open to anon: registration is how a client gets credentials in the first
-- place. Like cli_device_start, the route rate-limits per IP and this function
-- adds what a per-instance limiter can't: a global cap, and housekeeping so
-- the OAuth tables can't grow without bound.
--
-- The sweep, cheapest first:
--   * authorization codes older than a day (they expire after 5 minutes)
--   * tokens that expired more than a week ago (the week keeps a reused-token
--     investigation possible)
--   * DCR clients nobody ever authorized, 30 days on
--
-- Returns 'created' | 'rate_limited'.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_register_client(
  p_client_id text,
  p_secret_hash text,
  p_auth_method text,
  p_name text,
  p_client_uri text,
  p_redirect_uris text[],
  p_grant_types text[],
  p_metadata jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_client_id is null or p_client_id !~ '^oc_[0-9A-Za-z]{24}$' then
    raise exception 'Malformed client id';
  end if;

  if coalesce(cardinality(p_redirect_uris), 0) = 0
    or exists (
      select 1 from unnest(p_redirect_uris) u
      where u is null or char_length(u) not between 1 and 2048
    ) then
    raise exception 'Malformed redirect uris';
  end if;

  delete from public.oauth_authorization_codes where created_at < now() - interval '1 day';
  delete from public.oauth_tokens where expires_at < now() - interval '7 days';
  delete from public.oauth_clients c
  where c.kind = 'dcr'
    and c.created_at < now() - interval '30 days'
    and not exists (select 1 from public.oauth_grants g where g.client_id = c.id);

  if (
    select count(*) from public.oauth_clients
    where kind = 'dcr' and created_at > now() - interval '1 minute'
  ) >= 300 then
    return 'rate_limited';
  end if;

  insert into public.oauth_clients (
    client_id, kind, client_name, client_uri, redirect_uris, grant_types,
    token_endpoint_auth_method, client_secret_hash, metadata
  )
  values (
    p_client_id,
    'dcr',
    trim(p_name),
    nullif(trim(coalesce(p_client_uri, '')), ''),
    p_redirect_uris,
    coalesce(nullif(p_grant_types, '{}'), '{authorization_code,refresh_token}'),
    p_auth_method,
    p_secret_hash,
    p_metadata
  );

  return 'created';
end;
$$;

revoke all on function public.oauth_register_client(text, text, text, text, text, text[], text[], jsonb) from public;
grant execute on function public.oauth_register_client(text, text, text, text, text, text[], text[], jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. oauth_cache_cimd_client — store a fetched CIMD document
--
-- Called by the app after it fetched and validated https://…/client.json.
-- Upserts on client_id, so a refetch updates name and redirect URIs in place
-- and existing grants keep pointing at the same row. A dcr row can never be
-- overwritten this way (the client_id shapes can't collide anyway; this is the
-- belt to that brace).
--
-- Sweeps cached documents that went stale a week ago and that nobody granted
-- anything to, so fetching many distinct URLs can't grow the table forever.
--
-- Returns the row's id.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_cache_cimd_client(
  p_client_id text,
  p_name text,
  p_client_uri text,
  p_logo_uri text,
  p_redirect_uris text[],
  p_metadata jsonb,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_client_id is null or p_client_id !~ '^https://' or char_length(p_client_id) > 2048 then
    raise exception 'Malformed client id';
  end if;

  if p_expires_at is null or p_expires_at <= now() then
    raise exception 'Cache expiry must be in the future';
  end if;

  if coalesce(cardinality(p_redirect_uris), 0) = 0
    or exists (
      select 1 from unnest(p_redirect_uris) u
      where u is null or char_length(u) not between 1 and 2048
    ) then
    raise exception 'Malformed redirect uris';
  end if;

  delete from public.oauth_clients c
  where c.kind = 'cimd'
    and c.metadata_expires_at < now() - interval '7 days'
    and c.client_id <> p_client_id
    and not exists (select 1 from public.oauth_grants g where g.client_id = c.id);

  insert into public.oauth_clients (
    client_id, kind, client_name, client_uri, logo_uri, redirect_uris,
    token_endpoint_auth_method, client_secret_hash, metadata, metadata_expires_at
  )
  values (
    p_client_id,
    'cimd',
    trim(p_name),
    nullif(trim(coalesce(p_client_uri, '')), ''),
    nullif(trim(coalesce(p_logo_uri, '')), ''),
    p_redirect_uris,
    'none',
    null,
    p_metadata,
    p_expires_at
  )
  on conflict (client_id) do update
  set client_name = excluded.client_name,
      client_uri = excluded.client_uri,
      logo_uri = excluded.logo_uri,
      redirect_uris = excluded.redirect_uris,
      metadata = excluded.metadata,
      metadata_expires_at = excluded.metadata_expires_at
  where oauth_clients.kind = 'cimd'
  returning id into v_id;

  if v_id is null then
    raise exception 'client_id belongs to a registered (dcr) client';
  end if;

  return v_id;
end;
$$;

revoke all on function public.oauth_cache_cimd_client(text, text, text, text, text[], jsonb, timestamptz) from public;
grant execute on function public.oauth_cache_cimd_client(text, text, text, text, text[], jsonb, timestamptz) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. oauth_client_lookup — resolve a client_id from the wire
--
-- Used by /oauth/authorize (to render consent) and /token, /revoke (to
-- authenticate the client). Returns the secret's HMAC, which is useless
-- without the pepper, exactly like api_key_by_prefix. No row = unknown client.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_client_lookup(p_client_id text)
returns table (
  id uuid,
  client_id text,
  kind text,
  client_name text,
  client_uri text,
  logo_uri text,
  redirect_uris text[],
  grant_types text[],
  token_endpoint_auth_method text,
  client_secret_hash text,
  metadata_expires_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select c.id, c.client_id, c.kind, c.client_name, c.client_uri, c.logo_uri,
         c.redirect_uris, c.grant_types, c.token_endpoint_auth_method,
         c.client_secret_hash, c.metadata_expires_at
  from public.oauth_clients c
  where c.client_id = p_client_id;
$$;

revoke all on function public.oauth_client_lookup(text) from public;
grant execute on function public.oauth_client_lookup(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. oauth_authorize — the user clicked Approve
--
-- Runs as the signed-in user, who becomes the grant's owner. The app has
-- already validated the client, redirect_uri, scopes, PKCE challenge and
-- resource; this records the decision:
--
--   * upsert the active grant for (user, client), REPLACING its scopes with
--     what was just approved — consent is the latest word, and narrowing it
--     narrows live tokens too (effective = token ∩ grant)
--   * insert the authorization code under that grant
--
-- Returns the code's id (= the family id its tokens will carry).
-- ---------------------------------------------------------------------------

create or replace function public.oauth_authorize(
  p_client uuid,
  p_scopes text[],
  p_code_hash text,
  p_redirect_uri text,
  p_code_challenge text,
  p_resource text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.uid();
  v_grant uuid;
  v_code uuid;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if coalesce(cardinality(p_scopes), 0) = 0 then
    raise exception 'Authorizing requires at least one scope';
  end if;

  insert into public.oauth_grants as g (owner_id, client_id, scopes)
  values (v_uid, p_client, p_scopes)
  on conflict (owner_id, client_id) where revoked_at is null do update
  set scopes = excluded.scopes, updated_at = now()
  returning g.id into v_grant;

  insert into public.oauth_authorization_codes (
    code_hash, grant_id, client_id, owner_id, redirect_uri, code_challenge, scopes, resource
  )
  values (p_code_hash, v_grant, p_client, v_uid, p_redirect_uri, p_code_challenge, p_scopes, p_resource)
  returning id into v_code;

  return v_code;
end;
$$;

revoke all on function public.oauth_authorize(uuid, text[], text, text, text, text) from public;
revoke execute on function public.oauth_authorize(uuid, text[], text, text, text, text) from anon;
grant execute on function public.oauth_authorize(uuid, text[], text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. oauth_redeem_code — POST /oauth/token, grant_type=authorization_code
--
-- The whole redemption in one statement: find the code, check everything the
-- client presented against it, and mint the first token pair, all under one
-- row lock. There is deliberately no "exchange now, mint later" split: with
-- two calls, whatever links them (the family id) becomes a bearer credential
-- in between, and correctness hangs on the app calling them in the right
-- order with the right checks between. Here the database refuses to mint
-- unless every check passed in the same transaction.
--
-- Open to anon: possession of the code plus its PKCE verifier is the
-- credential. The caller supplies only what the client sent and the hashes
-- and expiries of the new tokens; scopes, resource and grant are copied from
-- the code, so nothing upstream can widen them.
--
-- Outcomes, checked in this order under FOR UPDATE on the code row:
--
--   invalid         unknown code, or presented by a different client. The
--                   code is left untouched: a stranger can't burn it.
--   reused          already consumed. Somebody is replaying it: revoke every
--                   token minted from it (the family), record replayed_at.
--                   Checked before expiry on purpose — a replay six minutes
--                   later is just as suspicious.
--
--   ── from here on the code is consumed, whatever the outcome. A request that
--      got this far named the right code and client; if anything else about it
--      is wrong, the code must not survive to be tried again (RFC 6749
--      §4.1.2, OAuth 2.1 §4.1.3). ──
--
--   expired         older than 5 minutes
--   revoked         the user revoked the grant between Approve and now
--   invalid_grant   redirect_uri differs from the one authorized, or the PKCE
--                   verifier is malformed or doesn't hash to the challenge
--   invalid_target  a resource was sent and differs from the authorized one
--                   (RFC 8707). Null means "the one I asked for at authorize".
--   ok              tokens minted; grant, owner, scopes and resource returned
--
-- PKCE S256 (RFC 7636 §4.6): base64url(sha256(ascii(verifier))) without
-- padding must equal code_challenge. sha256() is built into Postgres (11+),
-- so this needs no extension. The comparison is not constant-time, and need
-- not be: what it compares against, the challenge, was public in the
-- authorize URL.
--
-- p_refresh_hash may be null for a client registered without the
-- refresh_token grant type; then only an access token is minted.
--
-- replayed_at no longer guards anything (minting can't happen after the code
-- is consumed); it stays as the record of when a theft signal was seen.
-- ---------------------------------------------------------------------------


create or replace function public.oauth_redeem_code(
  p_code_hash text,
  p_client uuid,
  p_redirect_uri text,
  p_code_verifier text,
  p_resource text,
  p_access_hash text,
  p_access_expires timestamptz,
  p_refresh_hash text,
  p_refresh_expires timestamptz
)
returns table (
  outcome text,
  grant_id uuid,
  owner_id uuid,
  scopes text[],
  resource text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
-- ^ The OUT columns share names with table columns, as in cli_device_poll.
declare
  v_code public.oauth_authorization_codes%rowtype;
  v_grant_revoked timestamptz;
begin
  -- Caller bugs, not client errors: raise before touching anything.
  if p_access_expires is null or p_access_expires <= now() then
    raise exception 'Access token expiry must be in the future';
  end if;

  if p_refresh_hash is not null and (p_refresh_expires is null or p_refresh_expires <= now()) then
    raise exception 'Refresh token expiry must be in the future';
  end if;

  select * into v_code
  from public.oauth_authorization_codes c
  where c.code_hash = p_code_hash
  for update;

  if not found or v_code.client_id <> p_client then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_code.consumed_at is not null then
    update public.oauth_tokens t
    set revoked_at = now()
    where t.family_id = v_code.id and t.revoked_at is null;

    update public.oauth_authorization_codes c
    set replayed_at = coalesce(c.replayed_at, now())
    where c.id = v_code.id;

    return query select 'reused'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  update public.oauth_authorization_codes c
  set consumed_at = now()
  where c.id = v_code.id;

  if v_code.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  -- FOR SHARE: a concurrent oauth_revoke_grant waits for this transaction, so
  -- its token sweep sees the tokens minted below.
  select g.revoked_at into v_grant_revoked
  from public.oauth_grants g
  where g.id = v_code.grant_id
  for share;

  if v_grant_revoked is not null then
    return query select 'revoked'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if p_redirect_uri is distinct from v_code.redirect_uri then
    return query select 'invalid_grant'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if p_resource is not null and p_resource <> v_code.resource then
    return query select 'invalid_target'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if p_code_verifier is null
    or p_code_verifier !~ '^[A-Za-z0-9._~-]{43,128}$'
    or translate(
         rtrim(encode(pg_catalog.sha256(convert_to(p_code_verifier, 'UTF8')), 'base64'), '='),
         '+/', '-_'
       ) <> v_code.code_challenge then
    return query select 'invalid_grant'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  insert into public.oauth_tokens (token_hash, kind, grant_id, family_id, scopes, resource, expires_at)
  values (p_access_hash, 'access', v_code.grant_id, v_code.id, v_code.scopes, v_code.resource, p_access_expires);

  if p_refresh_hash is not null then
    insert into public.oauth_tokens (token_hash, kind, grant_id, family_id, scopes, resource, expires_at)
    values (p_refresh_hash, 'refresh', v_code.grant_id, v_code.id, v_code.scopes, v_code.resource, p_refresh_expires);
  end if;

  update public.oauth_clients c set last_used_at = now() where c.id = v_code.client_id;

  return query select 'ok'::text, v_code.grant_id, v_code.owner_id, v_code.scopes, v_code.resource;
end;
$$;

revoke all on function public.oauth_redeem_code(text, uuid, text, text, text, text, timestamptz, text, timestamptz) from public;
grant execute on function public.oauth_redeem_code(text, uuid, text, text, text, text, timestamptz, text, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- 10. oauth_rotate_refresh — POST /oauth/token, grant_type=refresh_token
--
-- The refresh token is spent and replaced on every use. FOR UPDATE on its row
-- makes that single-use the same way code redemption is.
--
-- Outcomes (checked in this order):
--
--   invalid        unknown token, not a refresh token, or another client's
--   reused         already rotated once. Revoke the whole family: whoever
--                  holds the newer token loses it too, and the user's next
--                  sign-in starts a clean lineage.
--   revoked        the token (or its family) or the grant was revoked
--   expired        past its 30 days
--   invalid_scope  a scope was requested that the old token didn't have
--                  (RFC 6749 §6: a refresh may narrow, never widen). The
--                  token is NOT spent, so the client can retry correctly.
--   ok             old token marked used; new access + refresh inserted with
--                  parent_id = old, same family, same resource
--
-- New scopes = (requested, or the old token's) ∩ old token ∩ grant. The grant
-- term means a re-consent that narrowed the grant also narrows what the next
-- refresh mints.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_rotate_refresh(
  p_refresh_hash text,
  p_client uuid,
  p_scopes text[],
  p_access_hash text,
  p_access_expires timestamptz,
  p_new_refresh_hash text,
  p_refresh_expires timestamptz
)
returns table (
  outcome text,
  grant_id uuid,
  owner_id uuid,
  scopes text[],
  resource text
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_tok public.oauth_tokens%rowtype;
  v_grant public.oauth_grants%rowtype;
  v_requested text[] := nullif(p_scopes, '{}');
  v_scopes text[];
begin
  if p_access_expires is null or p_access_expires <= now()
    or p_refresh_expires is null or p_refresh_expires <= now() then
    raise exception 'Token expiries must be in the future';
  end if;

  select t.* into v_tok
  from public.oauth_tokens t
  where t.token_hash = p_refresh_hash and t.kind = 'refresh'
  for update;

  if not found then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  select g.* into v_grant from public.oauth_grants g where g.id = v_tok.grant_id;

  if v_grant.client_id <> p_client then
    return query select 'invalid'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_tok.used_at is not null then
    update public.oauth_tokens t
    set revoked_at = now()
    where t.family_id = v_tok.family_id and t.revoked_at is null;

    return query select 'reused'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_tok.revoked_at is not null or v_grant.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_tok.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  if v_requested is not null and not (v_requested <@ v_tok.scopes) then
    return query select 'invalid_scope'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  select coalesce(array_agg(distinct s order by s), '{}') into v_scopes
  from unnest(coalesce(v_requested, v_tok.scopes)) as s
  where s = any (v_tok.scopes) and s = any (v_grant.scopes);

  -- Everything the token had was since removed from the grant: nothing left
  -- to mint. Not spent, same as above.
  if cardinality(v_scopes) = 0 then
    return query select 'invalid_scope'::text, null::uuid, null::uuid, null::text[], null::text;
    return;
  end if;

  update public.oauth_tokens t set used_at = now() where t.id = v_tok.id;

  insert into public.oauth_tokens (token_hash, kind, grant_id, family_id, parent_id, scopes, resource, expires_at)
  values
    (p_access_hash, 'access', v_tok.grant_id, v_tok.family_id, v_tok.id, v_scopes, v_tok.resource, p_access_expires),
    (p_new_refresh_hash, 'refresh', v_tok.grant_id, v_tok.family_id, v_tok.id, v_scopes, v_tok.resource, p_refresh_expires);

  update public.oauth_clients c set last_used_at = now() where c.id = v_grant.client_id;

  return query select 'ok'::text, v_grant.id, v_grant.owner_id, v_scopes, v_tok.resource;
end;
$$;

revoke all on function public.oauth_rotate_refresh(text, uuid, text[], text, timestamptz, text, timestamptz) from public;
grant execute on function public.oauth_rotate_refresh(text, uuid, text[], text, timestamptz, text, timestamptz) to anon;

-- ---------------------------------------------------------------------------
-- 11. oauth_token_lookup — authenticate a request carrying a bearer token
--
-- The OAuth twin of api_key_by_prefix: anon in, just enough out for the
-- authenticator to decide. It returns revoked and expired rows too, with the
-- grant's state alongside, so the decision (and the reason logged) lives in
-- one place in TypeScript: kind, expiry, revocation, audience, and effective
-- scopes = token ∩ grant.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_token_lookup(p_hash text)
returns table (
  token_id uuid,
  kind text,
  grant_id uuid,
  owner_id uuid,
  client_uuid uuid,
  client_name text,
  scopes text[],
  resource text,
  expires_at timestamptz,
  revoked_at timestamptz,
  grant_scopes text[],
  grant_revoked_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select t.id, t.kind, t.grant_id, g.owner_id, c.id, c.client_name,
         t.scopes, t.resource, t.expires_at, t.revoked_at,
         g.scopes, g.revoked_at
  from public.oauth_tokens t
  join public.oauth_grants g on g.id = t.grant_id
  join public.oauth_clients c on c.id = g.client_id
  where t.token_hash = p_hash;
$$;

revoke all on function public.oauth_token_lookup(text) from public;
grant execute on function public.oauth_token_lookup(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. oauth_touch_grant — "last used" for Settings
--
-- Fire-and-forget like touch_api_key, and throttled to one write a minute: an
-- MCP session can make dozens of calls a minute, and each would otherwise be
-- a row update for a value shown to the minute anyway.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_touch_grant(p_grant uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.oauth_grants
  set last_used_at = now()
  where id = p_grant
    and (last_used_at is null or last_used_at < now() - interval '1 minute');
$$;

revoke all on function public.oauth_touch_grant(uuid) from public;
grant execute on function public.oauth_touch_grant(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. oauth_revoke_token — POST /oauth/revoke (RFC 7009)
--
-- The client revokes its own token. Revoking a refresh token takes its whole
-- family (RFC 7009 §2.1: the access tokens from the same grant SHOULD go too);
-- revoking an access token takes just that token. Unknown tokens, and tokens
-- of another client, are a silent no-op: the endpoint always answers 200, so
-- it can't be used to probe which tokens exist.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_revoke_token(p_hash text, p_client uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tok public.oauth_tokens%rowtype;
begin
  select t.* into v_tok
  from public.oauth_tokens t
  join public.oauth_grants g on g.id = t.grant_id
  where t.token_hash = p_hash and g.client_id = p_client;

  if not found then
    return;
  end if;

  if v_tok.kind = 'refresh' then
    update public.oauth_tokens
    set revoked_at = now()
    where family_id = v_tok.family_id and revoked_at is null;
  else
    update public.oauth_tokens
    set revoked_at = now()
    where id = v_tok.id and revoked_at is null;
  end if;
end;
$$;

revoke all on function public.oauth_revoke_token(text, uuid) from public;
grant execute on function public.oauth_revoke_token(text, uuid) to anon;

-- ---------------------------------------------------------------------------
-- 14. oauth_revoke_grant — Settings → AI assistants → Revoke
--
-- The user disconnects an app. The grant and every token under it are revoked
-- in one statement each; unconsumed codes die with it (oauth_redeem_code
-- answers 'revoked'). Only the owner can revoke; anyone else gets false, as
-- does an already-revoked grant.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_revoke_grant(p_grant uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := app.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  update public.oauth_grants
  set revoked_at = now(), updated_at = now()
  where id = p_grant and owner_id = v_uid and revoked_at is null;

  if not found then
    return false;
  end if;

  update public.oauth_tokens
  set revoked_at = now()
  where grant_id = p_grant and revoked_at is null;

  return true;
end;
$$;

revoke all on function public.oauth_revoke_grant(uuid) from public;
revoke execute on function public.oauth_revoke_grant(uuid) from anon;
grant execute on function public.oauth_revoke_grant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. oauth_list_grants — the "Connected apps" list
--
-- The caller's grants with their client's display fields. A function rather
-- than a select on oauth_grants because oauth_clients is not readable from a
-- session (it holds secret hashes); this hands back only the safe columns.
-- ---------------------------------------------------------------------------

create or replace function public.oauth_list_grants(p_include_revoked boolean default false)
returns table (
  id uuid,
  client_uuid uuid,
  client_name text,
  client_kind text,
  client_id_text text,
  client_uri text,
  scopes text[],
  created_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select g.id, c.id, c.client_name, c.kind, c.client_id, c.client_uri,
         g.scopes, g.created_at, g.last_used_at, g.revoked_at
  from public.oauth_grants g
  join public.oauth_clients c on c.id = g.client_id
  where app.uid() is not null
    and g.owner_id = app.uid()
    and (p_include_revoked or g.revoked_at is null)
  order by g.revoked_at nulls first, g.created_at desc;
$$;

revoke all on function public.oauth_list_grants(boolean) from public;
revoke execute on function public.oauth_list_grants(boolean) from anon;
grant execute on function public.oauth_list_grants(boolean) to authenticated;
