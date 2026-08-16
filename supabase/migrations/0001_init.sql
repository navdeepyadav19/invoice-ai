-- Invoice-AI initial schema.
--
-- Design notes worth knowing before changing anything here:
--
--  * Tenant isolation lives in RLS, not in application code. Every table keys
--    off owner_id = auth.uid(). Guests get a real auth.uid() from anonymous
--    sign-in, so they are ordinary tenants and need no special-casing.
--  * Money is numeric(14,2) — exact decimal, never float. The app computes in
--    integer paise and converts at this boundary.
--  * Invoices freeze a JSONB snapshot of the business and client. Without it,
--    editing your address would silently rewrite every invoice you ever issued.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type invoice_status as enum ('draft', 'sent', 'paid', 'overdue', 'cancelled');

create type invoice_event_type as enum ('created', 'sent', 'viewed', 'downloaded', 'paid');

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  onboarding_step smallint not null default 1,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_onboarding_step_range check (onboarding_step between 1 and 3)
);

comment on column public.profiles.onboarding_completed_at is
  'Null means the onboarding wizard has not been finished. The (app) layout gates on this.';

comment on column public.profiles.onboarding_step is
  'Which wizard step to resume at. Kept server-side so closing the tab mid-signup loses nothing.';

-- ---------------------------------------------------------------------------
-- businesses — the "From" side of an invoice
-- ---------------------------------------------------------------------------

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  legal_name text not null,
  trade_name text,
  is_gst_registered boolean not null default false,
  gstin text,
  pan text,

  address_line1 text,
  address_line2 text,
  city text,
  state_code text not null,
  pincode text,
  country text not null default 'India',

  email text,
  phone text,
  logo_url text,
  signature_url text,

  bank_name text,
  account_name text,
  account_number text,
  ifsc text,
  upi_id text,

  default_notes text,
  default_terms text,

  invoice_prefix text not null default 'INV',
  next_invoice_number integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint businesses_gstin_shape check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  ),
  -- A registered business must carry a GSTIN, and it must agree with the state
  -- on file. The app validates this too, but enforcing it here means no code
  -- path — server action, SQL console, future import script — can bypass it.
  constraint businesses_gstin_matches_state check (
    not is_gst_registered
    or (gstin is not null and left(gstin, 2) = state_code)
  ),
  constraint businesses_next_number_positive check (next_invoice_number >= 1)
);

create index businesses_owner_idx on public.businesses (owner_id);

-- ---------------------------------------------------------------------------
-- clients — the "Bill To" side
-- ---------------------------------------------------------------------------

create table public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  gstin text,
  email text,
  phone text,

  address_line1 text,
  address_line2 text,
  city text,
  state_code text,
  pincode text,
  country text not null default 'India',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint clients_gstin_shape check (
    gstin is null or gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
  )
);

create index clients_owner_idx on public.clients (owner_id);

-- ---------------------------------------------------------------------------
-- invoices
-- ---------------------------------------------------------------------------

create table public.invoices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete restrict,
  client_id uuid references public.clients (id) on delete set null,

  -- Null until the invoice is first sent. Assigning on draft creation would
  -- punch gaps in the sequence every time someone abandons a draft, and gaps in
  -- a GST invoice series are exactly what an audit asks about.
  invoice_number text,

  status invoice_status not null default 'draft',
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'INR',

  place_of_supply_state_code text not null,
  is_export boolean not null default false,
  reverse_charge boolean not null default false,

  notes text,
  terms text,

  -- Frozen copies of the parties as they were when the invoice was issued.
  business_snapshot jsonb,
  client_snapshot jsonb,

  subtotal numeric(14, 2) not null default 0,
  discount_total numeric(14, 2) not null default 0,
  taxable_total numeric(14, 2) not null default 0,
  cgst_total numeric(14, 2) not null default 0,
  sgst_total numeric(14, 2) not null default 0,
  igst_total numeric(14, 2) not null default 0,
  cess_total numeric(14, 2) not null default 0,
  round_off numeric(14, 2) not null default 0,
  total numeric(14, 2) not null default 0,
  amount_in_words text,

  public_token uuid not null default gen_random_uuid(),

  sent_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint invoices_due_after_issue check (due_date is null or due_date >= issue_date),
  constraint invoices_sent_has_number check (status = 'draft' or invoice_number is not null)
);

create unique index invoices_public_token_idx on public.invoices (public_token);

-- Invoice numbers are unique per business, not globally.
create unique index invoices_number_per_business_idx
  on public.invoices (business_id, invoice_number)
  where invoice_number is not null;

create index invoices_owner_idx on public.invoices (owner_id, created_at desc);
create index invoices_status_idx on public.invoices (owner_id, status);

-- ---------------------------------------------------------------------------
-- invoice_items
-- ---------------------------------------------------------------------------

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position integer not null default 0,

  description text not null,
  hsn_sac text,
  quantity numeric(14, 3) not null default 1,
  unit text not null default 'NOS',
  rate numeric(14, 2) not null default 0,
  discount_percent numeric(5, 2) not null default 0,

  taxable_value numeric(14, 2) not null default 0,
  gst_rate numeric(5, 2) not null default 0,
  cgst_amount numeric(14, 2) not null default 0,
  sgst_amount numeric(14, 2) not null default 0,
  igst_amount numeric(14, 2) not null default 0,
  cess_rate numeric(5, 2) not null default 0,
  cess_amount numeric(14, 2) not null default 0,
  line_total numeric(14, 2) not null default 0,

  constraint invoice_items_quantity_positive check (quantity > 0),
  constraint invoice_items_discount_range check (discount_percent >= 0 and discount_percent <= 100)
);

create index invoice_items_invoice_idx on public.invoice_items (invoice_id, position);

-- ---------------------------------------------------------------------------
-- invoice_events — the audit trail behind "your client opened this"
-- ---------------------------------------------------------------------------

create table public.invoice_events (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  type invoice_event_type not null,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index invoice_events_invoice_idx on public.invoice_events (invoice_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
create trigger businesses_touch before update on public.businesses
  for each row execute function public.touch_updated_at();
create trigger clients_touch before update on public.clients
  for each row execute function public.touch_updated_at();
create trigger invoices_touch before update on public.invoices
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- New user -> profile row
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Fires for anonymous sign-ins too, so guests get a profile row like anyone else.
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.businesses enable row level security;
alter table public.clients enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.invoice_events enable row level security;

create policy "own profile" on public.profiles
  for all to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy "own businesses" on public.businesses
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "own clients" on public.clients
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "own invoices" on public.invoices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Children inherit ownership through their parent invoice rather than carrying
-- a duplicate owner_id that could drift out of sync with it.
create policy "own invoice items" on public.invoice_items
  for all to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id and i.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id and i.owner_id = (select auth.uid())
    )
  );

create policy "own invoice events" on public.invoice_events
  for all to authenticated
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_events.invoice_id and i.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_events.invoice_id and i.owner_id = (select auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- Public invoice access
--
-- The public page must read one invoice with no session at all. The tempting
-- shortcut is a route handler holding the service-role key, but that key
-- bypasses RLS entirely, so a single path bug would expose every tenant. This
-- function is the whole public surface instead: one argument, one unguessable
-- token, drafts excluded.
-- ---------------------------------------------------------------------------

create or replace function public.get_public_invoice(p_token uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'invoice', to_jsonb(i) - 'owner_id' - 'business_id' - 'client_id',
    'items', coalesce(
      (
        select jsonb_agg(to_jsonb(it) - 'invoice_id' order by it.position)
        from public.invoice_items it
        where it.invoice_id = i.id
      ),
      '[]'::jsonb
    )
  )
  from public.invoices i
  where i.public_token = p_token
    and i.status <> 'draft'
    and i.status <> 'cancelled';
$$;

revoke all on function public.get_public_invoice(uuid) from public;
grant execute on function public.get_public_invoice(uuid) to anon, authenticated;

-- Records a view/download against a public invoice without exposing the table.
create or replace function public.log_public_invoice_event(
  p_token uuid,
  p_type invoice_event_type
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id uuid;
begin
  if p_type not in ('viewed', 'downloaded') then
    raise exception 'Only viewed and downloaded may be logged publicly';
  end if;

  select id into v_invoice_id
  from public.invoices
  where public_token = p_token and status <> 'draft';

  if v_invoice_id is null then
    return;
  end if;

  insert into public.invoice_events (invoice_id, type)
  values (v_invoice_id, p_type);
end;
$$;

revoke all on function public.log_public_invoice_event(uuid, invoice_event_type) from public;
grant execute on function public.log_public_invoice_event(uuid, invoice_event_type) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Invoice numbering
--
-- Per-tenant sequential numbering, so a Postgres sequence is the wrong tool.
-- The UPDATE ... RETURNING takes a row lock on the business, which serialises
-- two invoices sent at the same instant instead of handing both the same number.
-- ---------------------------------------------------------------------------

create or replace function public.claim_invoice_number(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
  v_fy text;
  v_start_year integer;
begin
  if not exists (
    select 1 from public.businesses
    where id = p_business_id and owner_id = auth.uid()
  ) then
    raise exception 'Business not found';
  end if;

  update public.businesses
  set next_invoice_number = next_invoice_number + 1
  where id = p_business_id
  returning invoice_prefix, next_invoice_number - 1
  into v_prefix, v_number;

  -- Indian financial year: April to March.
  v_start_year := case
    when extract(month from current_date) >= 4 then extract(year from current_date)
    else extract(year from current_date) - 1
  end;

  v_fy := lpad((v_start_year % 100)::text, 2, '0') || '-' ||
          lpad(((v_start_year + 1) % 100)::text, 2, '0');

  return v_prefix || '/' || v_fy || '/' || lpad(v_number::text, 4, '0');
end;
$$;

revoke all on function public.claim_invoice_number(uuid) from public;
grant execute on function public.claim_invoice_number(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest -> existing account merge
--
-- Normally a guest becomes permanent by attaching an email to the same auth
-- user, so nothing moves. The exception is when the email they choose already
-- belongs to an account: two auth users can't be fused, so the guest's rows have
-- to be re-parented onto the existing one.
--
-- Doing that safely needs proof that whoever asks actually controlled the guest
-- session. A uuid alone is not proof — anyone could pass a stranger's uid and
-- harvest their invoices. So while still signed in as the guest (and therefore
-- subject to RLS) the app mints a single-use, short-lived token. Possession of
-- the token IS the proof, and redeeming it consumes it.
-- ---------------------------------------------------------------------------

create table public.merge_tokens (
  token uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index merge_tokens_owner_idx on public.merge_tokens (owner_id);

alter table public.merge_tokens enable row level security;

create policy "own merge tokens" on public.merge_tokens
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create or replace function public.redeem_merge_token(p_token uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source uuid;
  v_target uuid := auth.uid();
  v_moved integer := 0;
begin
  if v_target is null then
    raise exception 'Not authenticated';
  end if;

  -- Deleting as we read makes the token single-use even under a double submit.
  delete from public.merge_tokens
  where token = p_token and expires_at > now()
  returning owner_id into v_source;

  if v_source is null or v_source = v_target then
    return 0;
  end if;

  -- Order matters: invoices reference businesses, so move the parents first.
  update public.businesses set owner_id = v_target where owner_id = v_source;
  update public.clients set owner_id = v_target where owner_id = v_source;

  update public.invoices set owner_id = v_target where owner_id = v_source;
  get diagnostics v_moved = row_count;

  return v_moved;
end;
$$;

revoke all on function public.redeem_merge_token(uuid) from public;
grant execute on function public.redeem_merge_token(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Guest cleanup
--
-- Anonymous sign-in is an unauthenticated user-creation endpoint, so without
-- cleanup auth.users grows without bound. Guests are told in the app that their
-- invoices are kept for 30 days; this is what makes that true.
--
-- Deleting the auth user cascades to profiles, businesses, clients and invoices
-- through their foreign keys, so this one statement removes everything.
-- ---------------------------------------------------------------------------

create or replace function public.cleanup_stale_guests(p_days integer default 30)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  with removed as (
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - make_interval(days => p_days)
      -- Belt and braces: never touch a user who has since attached an email.
      and (u.email is null or u.email = '')
    returning u.id
  )
  select count(*) into v_deleted from removed;

  return v_deleted;
end;
$$;

revoke all on function public.cleanup_stale_guests(integer) from public;

comment on function public.cleanup_stale_guests(integer) is
  'Run daily. Schedule with pg_cron, or call it from a Vercel cron route using the service role key.';

-- Uncomment once pg_cron is enabled on the project (Database -> Extensions):
--
--   select cron.schedule(
--     'cleanup-stale-guests',
--     '0 3 * * *',
--     $cron$ select public.cleanup_stale_guests(30) $cron$
--   );

-- ---------------------------------------------------------------------------
-- Storage: logos and signatures
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('brand', 'brand', true)
on conflict (id) do nothing;

-- Files live under <user-id>/..., and the policy pins the first path segment to
-- the uploader so nobody can write into someone else's folder.
create policy "own brand uploads" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'brand'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'brand'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy "public brand read" on storage.objects
  for select to anon
  using (bucket_id = 'brand');
