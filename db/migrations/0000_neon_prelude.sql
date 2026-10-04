-- Neon prelude: the three things Supabase gave every project for free.
--
-- 0001-0014 were written against Supabase, where PostgREST turned a JWT into a
-- Postgres role plus an auth.uid(). On Neon the app talks to Postgres directly
-- (lib/db/scoped.ts), so this file recreates just enough of that contract for
-- the policies and SECURITY DEFINER functions to keep working unchanged:
--
--   1. Roles. `anon` and `authenticated` are NOLOGIN: nobody connects as them.
--      The app's login role switches into one with SET LOCAL ROLE at the start
--      of every transaction, which is what makes RLS apply. The login role
--      itself has BYPASSRLS on Neon, so forgetting the switch would expose
--      every tenant — hence a driver that never forgets, not a helper to call.
--
--   2. Identity. app.uid() reads a transaction-local setting the app pins next
--      to the role switch. It is the drop-in for Supabase's auth.uid(). The
--      schema is `app`, not `auth`, so it can never collide with the `auth`
--      schema Neon's Data API installs if that is ever switched on.
--
--   3. Grants. Supabase granted table privileges to its roles by default and
--      left RLS to do the filtering. Neon grants nothing, so the same defaults
--      are declared here — for `authenticated` only. `anon` gets no table
--      access at all; its whole surface is the token-taking definer functions.

-- ---------------------------------------------------------------------------
-- 1. Roles
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
end
$$;

-- SET TRUE is what permits SET ROLE (Postgres 16+). INHERIT FALSE keeps the
-- login role from silently picking up the roles' privileges.
grant anon, authenticated to current_user with inherit false, set true;

-- ---------------------------------------------------------------------------
-- 2. Identity
-- ---------------------------------------------------------------------------

create extension if not exists "pgcrypto";

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to anon, authenticated;

-- Null when no user is pinned (anon, or the owner connection used by cron).
create or replace function app.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

revoke all on function app.uid() from public;
grant execute on function app.uid() to anon, authenticated;

-- Timestamps leave the database as text and are parsed in lib/db/pool.ts. A
-- fixed zone keeps that text in one shape (…+00) on every connection.
do $$
begin
  execute format('alter database %I set timezone to %L', current_database(), 'UTC');
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;

-- Neon Auth's tables are reachable only through SECURITY DEFINER functions.
revoke all on schema neon_auth from anon, authenticated;
