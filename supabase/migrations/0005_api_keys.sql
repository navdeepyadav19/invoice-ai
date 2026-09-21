-- API keys: the first non-cookie way into this application.
--
-- The secret itself is never stored. What lands in `secret_hash` is
-- HMAC-SHA256(pepper, secret), where the pepper is an environment variable and
-- not a database column — so a stolen database dump is not a set of working
-- credentials. That is the difference between hashing and peppered hashing, and
-- it is the reason the app can survive a read-only leak of this table.
--
-- Why HMAC and not bcrypt/argon2: an API key is 32 random base62 characters,
-- roughly 190 bits of entropy. There is no dictionary to attack, so the slow-
-- hash property that protects human passwords buys nothing here and would cost
-- ~100ms on every single API request. Peppered HMAC is the right tool for
-- high-entropy secrets.

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  -- What the user typed when creating it: "Zapier", "My laptop".
  name text not null,

  -- The public half: inv_live_ab12cd34. Stored in the clear because it is not a
  -- secret — it is how we find the row to compare against, and how a leaked key
  -- is recognisable in a log or a GitHub secret scan.
  prefix text not null,

  secret_hash text not null,

  -- Subset of lib/auth/scopes.ts. Kept as text[] rather than an enum so adding
  -- a scope doesn't need a migration and a deploy in lockstep.
  scopes text[] not null default '{}',

  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  expires_at timestamptz,
  revoked_at timestamptz,

  constraint api_keys_name_not_blank check (char_length(trim(name)) > 0),
  constraint api_keys_scopes_not_empty check (cardinality(scopes) > 0)
);

-- Lookup is by prefix on every authenticated request, so it must be indexed.
-- Unique because the prefix is the identifier we resolve a key by; a collision
-- would make two keys ambiguous.
create unique index api_keys_prefix_idx on public.api_keys (prefix);
create index api_keys_owner_idx on public.api_keys (owner_id, created_at desc);

alter table public.api_keys enable row level security;

-- Same shape as every other table: you see your own rows and nobody else's.
--
-- Note what this policy does NOT permit, by omission: there is no path for an
-- API request to reach this table at all. Key management is web-UI-only, so a
-- leaked key cannot mint more keys, widen its own scopes, or delete the record
-- of itself. See lib/auth/scopes.ts — there is deliberately no `keys:manage`.
create policy "own api keys"
  on public.api_keys
  for all
  to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

comment on table public.api_keys is
  'Credentials for programmatic access. The secret is shown once at creation and only its peppered HMAC is stored.';

comment on column public.api_keys.prefix is
  'Public identifier, e.g. inv_live_ab12cd34. Greppable on purpose so a leaked key is detectable.';

comment on column public.api_keys.revoked_at is
  'Set instead of deleting the row, so the audit log can still name the key that made past requests.';

-- ---------------------------------------------------------------------------
-- Authentication lookup
--
-- Authenticating an API key is a chicken-and-egg problem: the caller has no
-- session yet, so auth.uid() is null and RLS would hide every row. This function
-- is the one deliberate exception — it runs as definer, takes a prefix, and
-- returns *only* what the authenticator needs to verify the secret and build a
-- context. It never returns rows for a prefix that doesn't exist, and the hash
-- it returns is useless without the pepper.
--
-- Callable by anon because that is exactly the state an API request starts in.
-- ---------------------------------------------------------------------------

create or replace function public.api_key_by_prefix(p_prefix text)
returns table (
  id uuid,
  owner_id uuid,
  secret_hash text,
  scopes text[],
  expires_at timestamptz,
  revoked_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select k.id, k.owner_id, k.secret_hash, k.scopes, k.expires_at, k.revoked_at
  from public.api_keys k
  where k.prefix = p_prefix;
$$;

revoke all on function public.api_key_by_prefix(text) from public;
grant execute on function public.api_key_by_prefix(text) to anon, authenticated;

-- Separate from the lookup so it can be fire-and-forget: recording "this key was
-- used" must never be able to fail the request it is describing.
create or replace function public.touch_api_key(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.api_keys set last_used_at = now() where id = p_id;
$$;

revoke all on function public.touch_api_key(uuid) from public;
grant execute on function public.touch_api_key(uuid) to anon, authenticated;
