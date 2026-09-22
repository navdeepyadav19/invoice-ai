-- Webhook payload v2: the event carries the same Invoice object as the REST API.
--
-- 0011's payload leaked storage details: internal UUIDs (invoice_id,
-- client_id), major-unit decimals (`total: 25000.00`) and the stored status
-- (never `overdue`). A receiver had to translate all three before it could
-- match an event to anything the API returned. From this migration on:
--
--   {
--     "id":         "<event uuid>",
--     "type":       "invoice.paid",
--     "created_at": "2026-09-29T14:20:00.123456+00:00",
--     "data": {
--       "object": {                         -- the REST `Invoice`, without `lines`
--         "id": "in_…", "object": "invoice", "number": "INV-0042",
--         "status": "paid", "customer": "cus_…", "currency": "USD",
--         "total": 2550000, "amount_due": 0, …
--       }
--     }
--   }
--
-- Money is integer minor units of the invoice currency (ISO 4217: ¥5000 is
-- 5000, $25.00 is 2500, 1.500 KWD is 1500) — the same table as lib/currency.ts.
-- `status` is derived exactly like lib/invoice-status.ts deriveStatus(): an
-- open invoice whose due_date is before today in UTC is `overdue`.
--
-- Breaking for existing subscribers by design; there are none yet. Signing,
-- delivery, retries and the trigger itself are unchanged — this replaces the
-- function body only (same name, same signature), so the trigger created in
-- 0011 (`invoice_events_enqueue_webhooks`) keeps calling it without being
-- dropped or recreated.

-- ---------------------------------------------------------------------------
-- 1. Currency minor units (mirror of lib/currency.ts)
-- ---------------------------------------------------------------------------

create or replace function public.currency_decimals(p_currency text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case
    when upper(p_currency) in (
      'BIF', 'CLP', 'DJF', 'GNF', 'ISK', 'JPY', 'KMF', 'KRW', 'PYG',
      'RWF', 'UGX', 'UYI', 'VND', 'VUV', 'XAF', 'XOF', 'XPF'
    ) then 0
    when upper(p_currency) in ('BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND') then 3
    else 2
  end;
$$;

comment on function public.currency_decimals(text) is
  'ISO 4217 minor-unit digits (JPY 0, USD 2, KWD 3). Must match lib/currency.ts.';

-- A stored numeric(14,2) amount -> integer minor units. round() on numeric
-- rounds half away from zero, like lib/currency.ts majorToMinor().
create or replace function public.to_minor_units(p_amount numeric, p_currency text)
returns bigint
language sql
immutable
set search_path = public
as $$
  select round(coalesce(p_amount, 0) * (10::numeric ^ public.currency_decimals(p_currency)))::bigint;
$$;

comment on function public.to_minor_units(numeric, text) is
  'Major-unit amount -> integer minor units of the currency, as sent on the REST wire.';

-- Pure helpers with nothing to protect, but closed like every other function
-- (see 0002): the security definer trigger below runs them as their owner.
revoke execute on function public.currency_decimals(text) from public, anon, authenticated;
revoke execute on function public.to_minor_units(numeric, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The outbox trigger function, v2 payload
-- ---------------------------------------------------------------------------

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
           'data', jsonb_build_object('object', inv.object)
         )
    into v_owner_id, v_payload
  from public.invoices i
  left join public.clients c on c.id = i.client_id
  cross join lateral (
    select case
             when i.status = 'open'
              and i.due_date is not null
              and i.due_date < (now() at time zone 'utc')::date
             then 'overdue'
             else i.status::text
           end as status
  ) s
  cross join lateral (
    -- Field for field the `Invoice` from lib/api/serialize.ts serializeInvoice(),
    -- minus `lines` (fetch GET /invoices/{id} for those).
    select jsonb_build_object(
      'id', i.public_id,
      'object', 'invoice',
      'number', i.invoice_number,
      'status', s.status,
      'customer', coalesce(c.public_id, i.client_id::text),
      'currency', i.currency,
      'collection_method', i.collection_method,
      'issue_date', i.issue_date,
      'due_date', i.due_date,
      'description', i.notes,
      'footer', i.terms,
      'subtotal', public.to_minor_units(i.subtotal, i.currency),
      'discount', public.to_minor_units(i.discount_total, i.currency),
      'taxable', public.to_minor_units(i.taxable_total, i.currency),
      'tax', public.to_minor_units(
        coalesce(i.tax_total, i.cgst_total + i.sgst_total + i.igst_total + i.cess_total),
        i.currency
      ),
      'total', public.to_minor_units(i.total, i.currency),
      'amount_due', case
        when s.status in ('open', 'overdue') then public.to_minor_units(i.total, i.currency)
        else 0
      end,
      'amount_in_words', i.amount_in_words,
      'public_url_token', i.public_token,
      'finalized_at', i.sent_at,
      'paid_at', i.paid_at,
      'voided_at', i.cancelled_at,
      'void_reason', i.cancel_reason,
      'created', i.created_at,
      'updated', i.updated_at
    ) as object
  ) inv
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
    -- An empty events array means "everything".
    and (cardinality(e.events) = 0 or v_event_name = any (e.events));

  return new;
end;
$$;

comment on function public.enqueue_webhook_deliveries() is
  'Outbox trigger on invoice_events: queues one delivery per subscribed endpoint. '
  'Payload v2 (0014): {id, type, created_at, data: {object: Invoice}} with public ids and minor units.';
