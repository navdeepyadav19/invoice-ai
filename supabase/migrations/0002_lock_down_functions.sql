-- Lock down SECURITY DEFINER functions.
--
-- 0001 tried to do this with `revoke all on function ... from public`, which
-- looks right and is not. Supabase installs ALTER DEFAULT PRIVILEGES that grant
-- EXECUTE on every new function in the public schema directly to the `anon` and
-- `authenticated` roles. PUBLIC is a different grantee, so revoking from it
-- leaves those grants in place.
--
-- The consequence, verified against the live project before this migration:
-- cleanup_stale_guests() — which deletes users — was callable by anyone holding
-- the publishable key, and that key ships to every browser.
--
-- Privileges must therefore name the roles explicitly. Public read paths stay
-- open on purpose; everything else is closed.

-- ---------------------------------------------------------------------------
-- Never callable from a browser session, whatever role it holds.
-- Runs from a scheduler (pg_cron) or with the service role.
-- ---------------------------------------------------------------------------

revoke execute on function public.cleanup_stale_guests(integer) from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Signed-in users only. Anonymous guests are `authenticated` too, which is what
-- we want: a guest legitimately claims invoice numbers and redeems merge tokens.
-- Both functions already verify auth.uid() against the row they touch; this
-- removes the ability to even reach that check unauthenticated.
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_invoice_number(uuid) from anon;
revoke execute on function public.redeem_merge_token(uuid) from anon;

-- ---------------------------------------------------------------------------
-- Deliberately left open to anon: these ARE the public invoice surface. Each
-- takes an unguessable token and returns nothing without one.
--
--   get_public_invoice(uuid)
--   log_public_invoice_event(uuid, invoice_event_type)
-- ---------------------------------------------------------------------------

-- Belt and braces for anything added later: stop the default grant from
-- applying to functions created by this role from here on.
alter default privileges in schema public revoke execute on functions from anon;
