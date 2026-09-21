-- Stripe-shaped API: status vocabulary, event names, and public resource IDs.
--
--   invoices.status: draft / open / paid / void  (sent -> open, cancelled -> void)
--   invoice_events.type: finalized / voided      (sent -> finalized, cancelled -> voided)
--   clients / invoices / invoice_items gain cus_ / in_ / ii_ public IDs
--   invoices gain collection_method (charge_automatically | send_invoice)
--
-- DB column names (sent_at, cancelled_at, cancel_reason) stay as they are:
-- renaming storage columns buys nothing and risks every existing query.

-- ---------------------------------------------------------------------------
-- 1. Status enum swap
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_status_new') then
    create type invoice_status_new as enum ('draft', 'open', 'paid', 'void');
  end if;
end
$$;

alter table public.invoices
  alter column status drop default;

-- This CHECK stores 'draft' as the OLD enum type, so ALTER COLUMN TYPE fails
-- re-validating it ("operator does not exist: invoice_status_new =
-- invoice_status"). Drop it here, re-add it once the swap is done.
alter table public.invoices
  drop constraint if exists invoices_sent_has_number;

alter table public.invoices
  alter column status type invoice_status_new
  using (
    case status::text
      when 'sent' then 'open'
      when 'cancelled' then 'void'
      when 'overdue' then 'open'
      else status::text
    end::invoice_status_new
  );

alter table public.invoices
  alter column status set default 'draft';

drop type if exists invoice_status;

alter type invoice_status_new rename to invoice_status;

alter table public.invoices
  add constraint invoices_sent_has_number
  check (status = 'draft' or invoice_number is not null);

-- ---------------------------------------------------------------------------
-- 2. Event type swap
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_event_type_new') then
    create type invoice_event_type_new as enum (
      'created', 'finalized', 'viewed', 'downloaded', 'paid',
      'updated', 'emailed', 'email_failed', 'voided'
    );
  end if;
end
$$;

alter table public.invoice_events
  alter column type type invoice_event_type_new
  using (
    case type::text
      when 'sent' then 'finalized'
      when 'cancelled' then 'voided'
      else type::text
    end::invoice_event_type_new
  );

-- Drop dependents of the old event type before removing it.
drop trigger if exists invoice_events_enqueue_webhooks on public.invoice_events;
drop function if exists public.enqueue_webhook_deliveries();
drop function if exists public.log_public_invoice_event(uuid, invoice_event_type);

drop type if exists invoice_event_type;

alter type invoice_event_type_new rename to invoice_event_type;

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
  where public_token = p_token
    and status <> 'draft'
    and status <> 'void';

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
-- 3. Functions that named the old statuses
-- ---------------------------------------------------------------------------

create or replace function public.issue_invoice(
  p_invoice_id uuid,
  p_meta jsonb default '{}'::jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_number  text;
  v_items   integer;
begin
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and owner_id = auth.uid()
  for update;

  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_invoice.invoice_number is not null then
    return v_invoice.invoice_number;
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  select count(*) into v_items
  from public.invoice_items
  where invoice_id = p_invoice_id;

  if v_items = 0 then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  v_number := public.claim_invoice_number(v_invoice.business_id);

  update public.invoices
  set invoice_number = v_number,
      status = 'open',
      sent_at = now()
  where id = p_invoice_id;

  insert into public.invoice_events (invoice_id, type, meta)
  values (p_invoice_id, 'finalized', coalesce(p_meta, '{}'::jsonb));

  return v_number;
end;
$$;

comment on function public.issue_invoice(uuid, jsonb) is
  'Finalizes a draft: assigns an invoice number and marks it open, atomically. '
  'Returns the existing number if already finalized.';

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
    and i.status <> 'void';
$$;

-- Webhook event names now follow the type directly: finalized -> invoice.finalized.
create or replace function public.enqueue_webhook_deliveries()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_event_name text;
  v_payload jsonb;
begin
  v_event_name := 'invoice.' || new.type::text;

  select i.owner_id,
         jsonb_build_object(
           'id', new.id,
           'type', v_event_name,
           'created_at', new.created_at,
           'data', jsonb_build_object(
             'invoice_id', i.id,
             'invoice_number', i.invoice_number,
             'status', i.status,
             'client_id', i.client_id,
             'total', i.total,
             'currency', i.currency,
             'issue_date', i.issue_date,
             'due_date', i.due_date
           )
         )
    into v_owner_id, v_payload
  from public.invoices i
  where i.id = new.invoice_id;

  if v_owner_id is null then
    return new;
  end if;

  insert into public.webhook_deliveries (endpoint_id, owner_id, event_type, payload)
  select e.id, v_owner_id, v_event_name, v_payload
  from public.webhook_endpoints e
  where e.owner_id = v_owner_id
    and e.active
    and e.disabled_at is null
    and (cardinality(e.events) = 0 or v_event_name = any (e.events));

  return new;
end;
$$;

create trigger invoice_events_enqueue_webhooks
  after insert on public.invoice_events
  for each row
  execute function public.enqueue_webhook_deliveries();

-- ---------------------------------------------------------------------------
-- 4. Public resource IDs: cus_ / in_ / ii_
-- ---------------------------------------------------------------------------

alter table public.clients
  add column if not exists public_id text unique;

alter table public.invoices
  add column if not exists public_id text unique;

alter table public.invoice_items
  add column if not exists public_id text unique;

update public.clients
set public_id = 'cus_' || substr(md5(id::text || gen_random_uuid()::text), 1, 24)
where public_id is null;

update public.invoices
set public_id = 'in_' || substr(md5(id::text || gen_random_uuid()::text), 1, 24)
where public_id is null;

update public.invoice_items
set public_id = 'ii_' || substr(md5(id::text || gen_random_uuid()::text), 1, 24)
where public_id is null;

alter table public.clients alter column public_id set not null;
alter table public.invoices alter column public_id set not null;
alter table public.invoice_items alter column public_id set not null;

-- Safety net: any insert path that forgets to mint an id (the invoice editor's
-- inline client insert did) still gets a well-formed one instead of a NOT NULL
-- violation.
alter table public.clients
  alter column public_id set default 'cus_' || substr(md5(gen_random_uuid()::text), 1, 24);
alter table public.invoices
  alter column public_id set default 'in_' || substr(md5(gen_random_uuid()::text), 1, 24);
alter table public.invoice_items
  alter column public_id set default 'ii_' || substr(md5(gen_random_uuid()::text), 1, 24);

-- Existing subscriptions use the pre-rename event names; without this they
-- silently stop matching.
update public.webhook_endpoints
set events = array_replace(array_replace(events, 'invoice.issued', 'invoice.finalized'), 'invoice.cancelled', 'invoice.voided')
where events && array['invoice.issued', 'invoice.cancelled'];

alter table public.clients
  drop constraint if exists clients_public_id_shape;
alter table public.clients
  add constraint clients_public_id_shape check (public_id ~ '^cus_[A-Za-z0-9]{24}$');

alter table public.invoices
  drop constraint if exists invoices_public_id_shape;
alter table public.invoices
  add constraint invoices_public_id_shape check (public_id ~ '^in_[A-Za-z0-9]{24}$');

alter table public.invoice_items
  drop constraint if exists invoice_items_public_id_shape;
alter table public.invoice_items
  add constraint invoice_items_public_id_shape check (public_id ~ '^ii_[A-Za-z0-9]{24}$');

comment on column public.clients.public_id is 'API-facing customer id: cus_….';
comment on column public.invoices.public_id is 'API-facing invoice id: in_….';
comment on column public.invoice_items.public_id is 'API-facing invoice item id: ii_….';

-- ---------------------------------------------------------------------------
-- 5. Collection method on invoices
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists collection_method text not null default 'send_invoice';

alter table public.invoices
  drop constraint if exists invoices_collection_method_shape;

alter table public.invoices
  add constraint invoices_collection_method_shape check (
    collection_method in ('charge_automatically', 'send_invoice')
  );

-- Teach the atomic item swap about catalog links and item public IDs.
-- (Supersedes the 0010 version.)
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
    product_id, price_id, public_id
  )
  select
    p_invoice_id, it."position", it.description, it.hsn_sac, it.quantity,
    coalesce(it.unit, 'NOS'), it.rate, coalesce(it.discount_percent, 0),
    it.taxable_value,
    coalesce(it.tax_rate, it.gst_rate, 0),
    coalesce(it.tax_amount, it.igst_amount, 0),
    coalesce(it.tax_rate, it.gst_rate, 0), 0, 0,
    coalesce(it.tax_amount, it.igst_amount, 0), 0, 0, it.line_total,
    it.product_id, it.price_id,
    coalesce(it.public_id, 'ii_' || substr(md5(gen_random_uuid()::text), 1, 24))
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
    price_id         uuid,
    public_id        text
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on column public.invoices.collection_method is
  'Stripe-style: charge_automatically or send_invoice. Stored; no auto-charging yet.';
