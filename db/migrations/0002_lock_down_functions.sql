-- Lock down SECURITY DEFINER functions.
--
-- History: this was written for Supabase, which installs ALTER DEFAULT
-- PRIVILEGES granting EXECUTE on every new public function straight to `anon`
-- and `authenticated`. Revoking from PUBLIC misses those grants. Neon has no
-- such defaults, but the rule stands: privileges name the roles explicitly.
-- Public read paths stay open on purpose; everything else is closed.

-- ---------------------------------------------------------------------------
-- Signed-in users only. The function already verifies app.uid() against the
-- row it touches; this removes the ability to even reach that check signed out.
-- ---------------------------------------------------------------------------

revoke execute on function public.claim_invoice_number(uuid) from anon;

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
