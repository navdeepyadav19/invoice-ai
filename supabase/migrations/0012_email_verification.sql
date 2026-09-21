-- App-level email verification.
--
-- Supabase's "Confirm email" setting is turned OFF so a new account can sign in
-- and start onboarding immediately. With it off, signUp() auto-confirms the user
-- and stamps auth.users.email_confirmed_at at creation, so that column no longer
-- means "this person proved they own the inbox". This migration moves that fact
-- into the app:
--
--   profiles.email_verified_at   null = unverified. Only ever set server-side.
--   email_verifications          one row per emailed link. Stores a SHA-256 of
--                                the token, never the token itself, so a leaked
--                                table is not a set of working links.
--
-- Written to be re-runnable (if not exists / create or replace / drop ... if
-- exists) because it ships alongside 0009-0011 and may be applied twice.
--
-- ORDER MATTERS: apply this BEFORE switching "Confirm email" off in the
-- dashboard. The backfill below trusts email_confirmed_at, which is only
-- meaningful for users created while confirmations were still on.

-- ---------------------------------------------------------------------------
-- 1. The verified flag
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists email_verified_at timestamptz;

comment on column public.profiles.email_verified_at is
  'When the user proved they own profiles.email. Null = unverified. Set only by SECURITY DEFINER functions; the guard trigger ignores client writes.';

-- "own profile" lets a signed-in user update their own row, which would let
-- anyone mark themselves verified with one PostgREST call. Column grants can't
-- fix that (a table-level UPDATE grant covers every column), so a trigger pins
-- the value whenever the write comes straight from a browser role.
--
-- Deliberately NOT security definer: current_user must be the caller's role.
-- Inside the definer functions below it is the function owner, so they pass.
create or replace function public.guard_email_verified_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' then
      new.email_verified_at := null;
    else
      new.email_verified_at := old.email_verified_at;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_email_verified on public.profiles;
create trigger profiles_guard_email_verified
  before insert or update on public.profiles
  for each row execute function public.guard_email_verified_at();

-- ---------------------------------------------------------------------------
-- 2. Tokens
-- ---------------------------------------------------------------------------

create table if not exists public.email_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  -- The address the link was sent to. If the account's email changes before
  -- the link is clicked, the link proves nothing about the new address.
  email text not null,

  -- hex(sha256(token)). The raw token only ever exists in the email.
  token_hash text not null,

  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  used_at timestamptz,

  constraint email_verifications_hash_shape check (token_hash ~ '^[0-9a-f]{64}$')
);

create unique index if not exists email_verifications_token_hash_key
  on public.email_verifications (token_hash);

-- Serves the resend rate limit: "latest link for this user".
create index if not exists email_verifications_user_created_idx
  on public.email_verifications (user_id, created_at desc);

-- RLS on with no policies: nothing reaches this table from a browser session.
-- The revoke is belt and braces against Supabase's default table grants.
alter table public.email_verifications enable row level security;
revoke all on table public.email_verifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_email_verification — mint a link for the signed-in user
--
-- The app generates the token, hashes it, and passes only the hash. Returns:
--   'created'           row inserted; the app should now send the email
--   'rate_limited'      a link was minted in the last 60 seconds
--   'already_verified'  nothing to do
--   'no_email'          a guest, or a user with no address yet
-- ---------------------------------------------------------------------------

create or replace function public.create_email_verification(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Malformed token hash';
  end if;

  select u.email into v_email from auth.users u where u.id = v_uid;

  if v_email is null or v_email = '' then
    return 'no_email';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.email_verified_at is not null
  ) then
    return 'already_verified';
  end if;

  -- Serialise concurrent requests from the same user so two clicks can't both
  -- pass the rate-limit check below.
  perform pg_advisory_xact_lock(hashtext('email_verification:' || v_uid::text));

  if exists (
    select 1 from public.email_verifications v
    where v.user_id = v_uid and v.created_at > now() - interval '60 seconds'
  ) then
    return 'rate_limited';
  end if;

  insert into public.email_verifications (user_id, email, token_hash)
  values (v_uid, v_email, p_token_hash);

  return 'created';
end;
$$;

revoke all on function public.create_email_verification(text) from public;
revoke execute on function public.create_email_verification(text) from anon;
grant execute on function public.create_email_verification(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. redeem_email_verification — the link was clicked
--
-- Open to anon on purpose: people open verification links on their phone, where
-- they are not signed in. Possession of the token is the proof, exactly like
-- get_public_invoice. Returns:
--   'verified' | 'already_verified' | 'expired' | 'used' | 'email_changed' | 'invalid'
-- ---------------------------------------------------------------------------

create or replace function public.redeem_email_verification(p_token_hash text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.email_verifications%rowtype;
  v_current_email text;
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return 'invalid';
  end if;

  -- Row lock makes a double click (or a link scanner racing the user) single-use.
  select * into v_row
  from public.email_verifications
  where token_hash = p_token_hash
  for update;

  if not found then
    return 'invalid';
  end if;

  select u.email into v_current_email from auth.users u where u.id = v_row.user_id;

  if v_current_email is null or lower(v_current_email) <> lower(v_row.email) then
    return 'email_changed';
  end if;

  if exists (
    select 1 from public.profiles p
    where p.id = v_row.user_id and p.email_verified_at is not null
  ) then
    update public.email_verifications set used_at = coalesce(used_at, now()) where id = v_row.id;
    return 'already_verified';
  end if;

  if v_row.used_at is not null then
    return 'used';
  end if;

  if v_row.expires_at <= now() then
    return 'expired';
  end if;

  update public.email_verifications set used_at = now() where id = v_row.id;
  update public.profiles set email_verified_at = now() where id = v_row.user_id;

  return 'verified';
end;
$$;

revoke all on function public.redeem_email_verification(text) from public;
grant execute on function public.redeem_email_verification(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. sync_oauth_email_verification — Google already verified the address
--
-- Called from /auth/callback after an OAuth exchange. It trusts nothing the
-- client says: it only marks the caller verified if auth.identities holds a
-- Google identity for the account's CURRENT email that Google itself flagged as
-- verified. Safe to call at any time; returns whether the user is now verified.
-- ---------------------------------------------------------------------------

create or replace function public.sync_oauth_email_verification()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return false;
  end if;

  update public.profiles p
  set email_verified_at = now()
  from auth.users u
  where p.id = v_uid
    and u.id = p.id
    and p.email_verified_at is null
    and u.email is not null
    and exists (
      select 1 from auth.identities i
      where i.user_id = u.id
        and i.provider = 'google'
        and lower(i.identity_data ->> 'email') = lower(u.email)
        and coalesce(i.identity_data ->> 'email_verified', 'true') in ('true', 't')
    );

  return exists (
    select 1 from public.profiles p
    where p.id = v_uid and p.email_verified_at is not null
  );
end;
$$;

revoke all on function public.sync_oauth_email_verification() from public;
revoke execute on function public.sync_oauth_email_verification() from anon;
grant execute on function public.sync_oauth_email_verification() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. A new address is an unverified address
--
-- Verification is a fact about one inbox. When auth.users.email changes (a guest
-- attaching an email, or a future "change email" screen) the flag resets.
-- ---------------------------------------------------------------------------

create or replace function public.reset_email_verification_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email_verified_at = null where id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.reset_email_verification_on_change() from public;
revoke execute on function public.reset_email_verification_on_change() from anon, authenticated;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.reset_email_verification_on_change();

-- ---------------------------------------------------------------------------
-- 7. Backfill
--
-- Everyone who already proved their address keeps that status: users confirmed
-- through Supabase's own link while confirmations were on, and Google sign-ups.
-- Only fills nulls, so re-running is harmless.
-- ---------------------------------------------------------------------------

update public.profiles p
set email_verified_at = coalesce(u.email_confirmed_at, u.created_at, now())
from auth.users u
where u.id = p.id
  and p.email_verified_at is null
  and u.email is not null
  and u.email <> ''
  and (
    u.email_confirmed_at is not null
    or u.raw_app_meta_data ->> 'provider' = 'google'
  );
