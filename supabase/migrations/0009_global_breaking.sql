-- Worldwide foundation: country + currency + optional tax ID.
-- India-only GST registry fields stay on the row for old accounts but are no
-- longer required or read. New code uses country_code / currency / tax_id and
-- the generic tax_total / tax_amount columns.

alter table public.businesses
  alter column state_code drop not null;

alter table public.businesses
  add column if not exists country_code text,
  add column if not exists currency text,
  add column if not exists region text,
  add column if not exists tax_id text,
  add column if not exists routing_number text,
  add column if not exists postal_code text;

-- Existing rows predate the global rewrite and are Indian accounts (GSTIN,
-- state codes, INR invoices). Backfilling them as US/USD would make every new
-- draft default to dollars, so infer India from the GST-era fields.
update public.businesses
set
  country_code = coalesce(country_code, case
    when gstin is not null or nullif(state_code, '') is not null or country ilike 'india' then 'IN'
    else 'US'
  end),
  currency = coalesce(currency, case
    when gstin is not null or nullif(state_code, '') is not null or country ilike 'india' then 'INR'
    else 'USD'
  end),
  region = coalesce(region, nullif(state_code, '')),
  postal_code = coalesce(postal_code, pincode),
  tax_id = coalesce(tax_id, gstin)
where country_code is null or currency is null;

alter table public.businesses
  alter column country_code set default 'US',
  alter column currency set default 'USD';

alter table public.businesses
  alter column country_code set not null,
  alter column currency set not null;

alter table public.businesses
  drop constraint if exists businesses_gstin_shape;

alter table public.businesses
  drop constraint if exists businesses_gstin_matches_state;

alter table public.businesses
  drop constraint if exists businesses_country_code_shape;

alter table public.businesses
  add constraint businesses_country_code_shape check (country_code ~ '^[A-Z]{2}$');

alter table public.businesses
  drop constraint if exists businesses_currency_shape;

alter table public.businesses
  add constraint businesses_currency_shape check (currency ~ '^[A-Z]{3}$');

comment on column public.businesses.country_code is 'ISO 3166-1 alpha-2.';
comment on column public.businesses.currency is 'ISO 4217 default invoice currency.';
comment on column public.businesses.tax_id is 'Optional VAT / EIN / GSTIN / ABN. No format check.';

alter table public.clients
  add column if not exists country_code text,
  add column if not exists region text,
  add column if not exists postal_code text,
  add column if not exists tax_id text;

update public.clients
set
  country_code = coalesce(country_code, case
    when gstin is not null or nullif(state_code, '') is not null or country ilike 'india' then 'IN'
    else 'US'
  end),
  region = coalesce(region, nullif(state_code, '')),
  postal_code = coalesce(postal_code, pincode),
  tax_id = coalesce(tax_id, gstin)
where country_code is null;

alter table public.clients
  alter column country_code set default 'US';

-- Deliberately nullable: the client form and the invoice editor send an
-- explicit null when no country is picked, and a column default does not
-- cover an explicit null. clients_country_code_shape below allows null too.

alter table public.clients
  drop constraint if exists clients_gstin_shape;

alter table public.businesses
  drop constraint if exists businesses_prefix_length;

alter table public.businesses
  add constraint businesses_prefix_length
  check (char_length(invoice_prefix) between 1 and 16);

alter table public.clients
  drop constraint if exists clients_country_code_shape;

alter table public.clients
  add constraint clients_country_code_shape check (
    country_code is null or country_code ~ '^[A-Z]{2}$'
  );

alter table public.invoices
  alter column place_of_supply_state_code drop not null;

alter table public.invoices
  add column if not exists tax_total numeric(14, 2) not null default 0;

update public.invoices
set tax_total = coalesce(cgst_total, 0) + coalesce(sgst_total, 0) + coalesce(igst_total, 0) + coalesce(cess_total, 0)
where tax_total = 0
  and (coalesce(cgst_total, 0) <> 0 or coalesce(sgst_total, 0) <> 0 or coalesce(igst_total, 0) <> 0 or coalesce(cess_total, 0) <> 0);

alter table public.invoice_items
  add column if not exists tax_rate numeric(5, 2) not null default 0,
  add column if not exists tax_amount numeric(14, 2) not null default 0;

update public.invoice_items
set
  tax_rate = coalesce(gst_rate, 0),
  tax_amount = coalesce(cgst_amount, 0) + coalesce(sgst_amount, 0) + coalesce(igst_amount, 0) + coalesce(cess_amount, 0)
where (tax_amount = 0 or tax_rate = 0)
  and (coalesce(cgst_amount, 0) <> 0 or coalesce(sgst_amount, 0) <> 0 or coalesce(igst_amount, 0) <> 0 or coalesce(cess_amount, 0) <> 0 or coalesce(gst_rate, 0) <> 0);

-- Locale-neutral invoice numbers: PREFIX-0001. Existing issued numbers stay put.
create or replace function public.claim_invoice_number(p_business_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_number integer;
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

  return v_prefix || '-' || lpad(v_number::text, 4, '0');
end;
$$;

-- Line-item replacement learns the generic tax columns. Legacy GST columns are
-- still written so old rows keep reading back identically.
create or replace function public.replace_invoice_items(
  p_invoice_id uuid,
  p_items jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.invoice_status;
  v_count  integer;
begin
  select status into v_status
  from public.invoices
  where id = p_invoice_id and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  delete from public.invoice_items where invoice_id = p_invoice_id;

  insert into public.invoice_items (
    invoice_id, "position", description, hsn_sac, quantity, unit, rate,
    discount_percent, taxable_value, tax_rate, tax_amount,
    gst_rate, cgst_amount, sgst_amount,
    igst_amount, cess_rate, cess_amount, line_total
  )
  select
    p_invoice_id, it."position", it.description, it.hsn_sac, it.quantity,
    coalesce(it.unit, 'NOS'), it.rate, coalesce(it.discount_percent, 0),
    it.taxable_value,
    coalesce(it.tax_rate, it.gst_rate, 0),
    coalesce(it.tax_amount, it.igst_amount, 0),
    coalesce(it.tax_rate, it.gst_rate, 0), 0, 0,
    coalesce(it.tax_amount, it.igst_amount, 0), 0, 0, it.line_total
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as it(
    "position"       integer,
    description      text,
    hsn_sac          text,
    quantity         numeric,
    unit             text,
    rate             numeric,
    discount_percent numeric,
    taxable_value    numeric,
    tax_rate         numeric,
    tax_amount       numeric,
    gst_rate         numeric,
    cgst_amount      numeric,
    sgst_amount      numeric,
    igst_amount      numeric,
    cess_rate        numeric,
    cess_amount      numeric,
    line_total       numeric
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function public.issue_invoice(uuid, jsonb) is
  'Assigns an invoice number and marks the invoice issued, atomically. '
  'Returns the existing number if already issued.';

