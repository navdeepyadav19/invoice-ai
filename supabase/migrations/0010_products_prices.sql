-- Products & Prices catalog, Stripe-style.
--
-- A Product is a named thing you sell. A Price is one way to charge for it:
-- an amount in a currency, one-off or recurring. One product has many prices
-- (monthly vs yearly, USD vs EUR, tiers added later).
--
-- Recurring here is a data model only: the interval is stored and shown, but
-- nothing auto-generates invoices yet.

create table public.products (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,

  name text not null,
  description text,
  images jsonb not null default '[]'::jsonb,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint products_public_id_shape check (public_id ~ '^prod_[A-Za-z0-9]{16,32}$'),
  constraint products_name_length check (char_length(name) between 1 and 200)
);

create index products_owner_idx on public.products (owner_id, created_at desc);

create table public.prices (
  id uuid primary key default gen_random_uuid(),
  public_id text not null unique,
  owner_id uuid not null references auth.users (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,

  nickname text,
  unit_amount numeric(14, 2) not null default 0,
  currency text not null,
  type text not null default 'one_time',
  recurring_interval text,
  interval_count integer not null default 1,
  tax_rate numeric(5, 2) not null default 0,
  active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint prices_public_id_shape check (public_id ~ '^price_[A-Za-z0-9]{16,32}$'),
  constraint prices_currency_shape check (currency ~ '^[A-Z]{3}$'),
  constraint prices_type_shape check (type in ('one_time', 'recurring')),
  constraint prices_interval_shape check (
    recurring_interval is null
    or recurring_interval in ('day', 'week', 'month', 'year')
  ),
  constraint prices_recurring_needs_interval check (
    (type = 'recurring' and recurring_interval is not null)
    or (type = 'one_time' and recurring_interval is null)
  ),
  constraint prices_interval_count_range check (interval_count between 1 and 52),
  constraint prices_amount_nonnegative check (unit_amount >= 0),
  constraint prices_tax_range check (tax_rate >= 0 and tax_rate <= 100)
);

create index prices_owner_idx on public.prices (owner_id, created_at desc);
create index prices_product_idx on public.prices (product_id);

-- Invoice lines can point at a price (and through it, a product).
-- Null means an ad-hoc line typed into the builder.
alter table public.invoice_items
  add column if not exists product_id uuid references public.products (id) on delete set null,
  add column if not exists price_id uuid references public.prices (id) on delete set null;

create index if not exists invoice_items_price_idx on public.invoice_items (price_id);

-- ---------------------------------------------------------------------------
-- RLS: catalog rows belong to their owner, like everything else.
-- ---------------------------------------------------------------------------

alter table public.products enable row level security;
alter table public.prices enable row level security;

create policy "own products" on public.products
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create policy "own prices" on public.prices
  for all to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger prices_touch before update on public.prices
  for each row execute function public.touch_updated_at();

-- Teach the atomic item swap about the catalog links.
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
    igst_amount, cess_rate, cess_amount, line_total,
    product_id, price_id
  )
  select
    p_invoice_id, it."position", it.description, it.hsn_sac, it.quantity,
    coalesce(it.unit, 'NOS'), it.rate, coalesce(it.discount_percent, 0),
    it.taxable_value,
    coalesce(it.tax_rate, it.gst_rate, 0),
    coalesce(it.tax_amount, it.igst_amount, 0),
    coalesce(it.tax_rate, it.gst_rate, 0), 0, 0,
    coalesce(it.tax_amount, it.igst_amount, 0), 0, 0, it.line_total,
    it.product_id, it.price_id
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
    line_total       numeric,
    product_id       uuid,
    price_id         uuid
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
