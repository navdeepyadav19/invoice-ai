-- GST prefill and the two-step onboarding it enables.
--
-- Onboarding used to be three manual steps. It now asks one question ("do you
-- have a GSTIN?"), fetches everything else from the GST registry, and then asks
-- only for bank details. Everything the API can't supply moved to settings.

alter table public.businesses
  -- Normalised constitution: sole_trader | partnership | limited_company | other.
  -- Derived from the registry's `ctb` field when a GSTIN is supplied, asked
  -- directly only when it isn't.
  add column if not exists business_type text,
  -- The registry's own wording, kept verbatim so the confirmation screen can
  -- show what the government actually holds rather than our normalisation.
  add column if not exists gst_constitution text,
  -- Active / Cancelled / Suspended. A cancelled registration still returns data,
  -- and issuing tax invoices against one is a problem worth surfacing.
  add column if not exists gst_status text,
  add column if not exists gst_registered_on text,
  -- Raw API response. Cheap to keep and the only way to answer "why did we
  -- prefill that?" once a user has edited the fields.
  add column if not exists gst_data jsonb,
  add column if not exists gst_fetched_at timestamptz;

alter table public.businesses
  drop constraint if exists businesses_business_type_valid;

alter table public.businesses
  add constraint businesses_business_type_valid check (
    business_type is null
    or business_type in ('sole_trader', 'partnership', 'limited_company', 'other')
  );

comment on column public.businesses.gst_data is
  'Verbatim Search GSTIN response from the Sandbox API at the time of prefill.';

-- Onboarding is two steps now, not three. The old CHECK allowed 1-3; keeping it
-- permissive avoids breaking anyone mid-flow on an existing row.
alter table public.profiles
  drop constraint if exists profiles_onboarding_step_range;

alter table public.profiles
  add constraint profiles_onboarding_step_range check (onboarding_step between 1 and 3);
