-- Payments ledger: money received against invoices, from any source.
--
-- Until now "paid" was a flag: POST /pay flipped an open invoice to paid and
-- nothing recorded what arrived, how much, or how. Online payments (Stripe
-- first, others later), partial payments and refunds all need the money itself
-- on record, so this migration adds a ledger beside the invoice:
--
--   invoices          unchanged as a document. It gains running totals:
--                       amount_paid      net money applied (payments − refunds)
--                       amount_credited  what the merchant agreed is no longer owed
--                     and amount_remaining = total − amount_credited − amount_paid.
--   payments          one row per payment: manual (bank transfer, cash) or a
--                     provider payment (Stripe PaymentIntent).
--   refunds           money sent back against a payment.
--   invoice_credits   a credit adjustment (stub for numbered credit notes).
--   payment_connections  a merchant's connected provider account (Stripe acct_…).
--   checkout_sessions the hosted checkout pages we opened for an invoice.
--   provider_events   inbound webhook ids already processed (dedupe).
--
-- Accounting rules this encodes:
--
--  * A finalized invoice is a document; it is never edited to reflect money.
--    Payments and credits sit beside it and the balance is derived.
--  * Status keeps its four values. An invoice stays `open` until nothing
--    remains, then becomes `paid`. "Partially paid" is open with amount_paid > 0
--    — the same model as Stripe's Invoice (amount_paid / amount_remaining).
--  * A refund always reduces amount_paid. Whether the client still owes that
--    money is a separate decision: if not, an equal credit is recorded and the
--    invoice stays settled; if so, the balance reopens (paid → open).
--  * Money that cannot be applied (the invoice is void, already paid, or the
--    payment is larger than the balance) is still recorded — it was received —
--    with amount_applied < amount and needs_attention set, so the merchant can
--    refund it. Losing a record of received money is the one unacceptable outcome.
--
-- Every change to money goes through the SECURITY DEFINER functions at the
-- end, which lock the invoice row (FOR UPDATE) so a manual "mark paid" and an
-- online payment arriving at the same moment cannot double-count. The new
-- tables have SELECT-only policies for owners; nothing writes them directly.
--
-- Amounts are numeric(14,2) in major units, like every money column on
-- invoices, so balances compare exactly. Provider minor units are converted at
-- the edge with currency_decimals() (0014).
--
-- Re-runnable where practical (if not exists / create or replace), like 0016.

-- ---------------------------------------------------------------------------
-- 1. New invoice event types
--
-- ADD VALUE can't be used in the same transaction it is added in; nothing below
-- inserts these values, only function bodies mention them (checked at run time).
-- ---------------------------------------------------------------------------

alter type invoice_event_type add value if not exists 'payment_succeeded';
alter type invoice_event_type add value if not exists 'payment_failed';
alter type invoice_event_type add value if not exists 'refunded';
alter type invoice_event_type add value if not exists 'credited';
alter type invoice_event_type add value if not exists 'dispute_opened';
alter type invoice_event_type add value if not exists 'dispute_closed';

-- ---------------------------------------------------------------------------
-- 2. Business defaults and invoice running totals
-- ---------------------------------------------------------------------------

alter table public.businesses
  add column if not exists pay_online_default boolean not null default true,
  add column if not exists show_bank_details_default boolean not null default true,
  add column if not exists allow_partial_default boolean not null default false,
  add column if not exists partial_min_percent integer;

alter table public.businesses
  drop constraint if exists businesses_partial_min_percent_range;
alter table public.businesses
  add constraint businesses_partial_min_percent_range
  check (partial_min_percent is null or partial_min_percent between 1 and 100);

alter table public.invoices
  -- How this invoice may be paid. Copied from the business defaults when the
  -- invoice is created; editable while it is a draft.
  add column if not exists payment_options jsonb not null
    default '{"online": true, "bank_details": true, "allow_partial": false, "partial_min_percent": null}'::jsonb,
  add column if not exists amount_paid numeric(14, 2) not null default 0,
  add column if not exists amount_credited numeric(14, 2) not null default 0,
  -- True once any test-mode payment touched this invoice; the UI shows TEST.
  add column if not exists has_test_payments boolean not null default false;

alter table public.invoices drop constraint if exists invoices_amount_paid_nonneg;
alter table public.invoices
  add constraint invoices_amount_paid_nonneg check (amount_paid >= 0);
alter table public.invoices drop constraint if exists invoices_amount_credited_nonneg;
alter table public.invoices
  add constraint invoices_amount_credited_nonneg check (amount_credited >= 0);

-- ---------------------------------------------------------------------------
-- 3. payment_connections
-- ---------------------------------------------------------------------------

create table if not exists public.payment_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  mode text not null check (mode in ('test', 'live')),
  external_account_id text not null,
  status text not null default 'active' check (status in ('active', 'restricted', 'disconnected')),
  display_name text,
  country text,
  default_currency text,
  charges_ready boolean not null default false,
  connected_at timestamptz not null default now(),
  disconnected_at timestamptz,
  updated_at timestamptz not null default now()
);

-- One live connection per merchant at a time (test or live, not both).
create unique index if not exists payment_connections_one_active
  on public.payment_connections (owner_id)
  where status <> 'disconnected';

create index if not exists payment_connections_account
  on public.payment_connections (provider, external_account_id);

alter table public.payment_connections enable row level security;

drop policy if exists "own payment connections" on public.payment_connections;
create policy "own payment connections" on public.payment_connections
  for select to authenticated
  using (owner_id = (select app.uid()));

-- ---------------------------------------------------------------------------
-- 4. payments
-- ---------------------------------------------------------------------------

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null default ('pay_' || substr(md5(gen_random_uuid()::text), 1, 24)),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,

  provider text not null check (provider in ('manual', 'stripe')),
  mode text not null default 'live' check (mode in ('test', 'live')),
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed')),

  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  -- The part of `amount` counted against the invoice. Less than `amount` when
  -- the invoice was void, already paid, or the payment overshot the balance.
  amount_applied numeric(14, 2) not null default 0 check (amount_applied >= 0),
  amount_refunded numeric(14, 2) not null default 0 check (amount_refunded >= 0),
  needs_attention text check (needs_attention in ('overpaid', 'invoice_void', 'invoice_paid', 'currency_mismatch')),

  external_payment_id text,
  checkout_session_id text,
  charge_id text,
  external_account_id text,
  method_type text,
  reference text check (reference is null or char_length(reference) <= 200),

  paid_at timestamptz not null default now(),
  receipt_sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint payments_applied_le_amount check (amount_applied <= amount),
  constraint payments_refunded_le_amount check (amount_refunded <= amount)
);

-- A provider payment is recorded once, however often its webhook arrives.
create unique index if not exists payments_provider_external
  on public.payments (provider, external_payment_id)
  where external_payment_id is not null;

create index if not exists payments_invoice on public.payments (invoice_id, created_at desc);
create index if not exists payments_owner on public.payments (owner_id, created_at desc);

alter table public.payments enable row level security;

drop policy if exists "own payments" on public.payments;
create policy "own payments" on public.payments
  for select to authenticated
  using (owner_id = (select app.uid()));

-- ---------------------------------------------------------------------------
-- 5. refunds and invoice_credits
-- ---------------------------------------------------------------------------

create table if not exists public.refunds (
  id uuid primary key default gen_random_uuid(),
  public_id text unique not null default ('re_' || substr(md5(gen_random_uuid()::text), 1, 24)),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  payment_id uuid not null references public.payments (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  reason text check (reason is null or char_length(reason) <= 500),
  client_still_owes boolean not null default false,
  status text not null default 'succeeded' check (status in ('pending', 'succeeded', 'failed')),
  external_refund_id text,
  created_by uuid,
  created_at timestamptz not null default now()
);

create unique index if not exists refunds_external
  on public.refunds (external_refund_id)
  where external_refund_id is not null;

create index if not exists refunds_payment on public.refunds (payment_id);

alter table public.refunds enable row level security;

drop policy if exists "own refunds" on public.refunds;
create policy "own refunds" on public.refunds
  for select to authenticated
  using (owner_id = (select app.uid()));

create table if not exists public.invoice_credits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  amount numeric(14, 2) not null check (amount > 0),
  reason text check (reason is null or char_length(reason) <= 500),
  refund_id uuid references public.refunds (id) on delete set null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists invoice_credits_invoice on public.invoice_credits (invoice_id);

alter table public.invoice_credits enable row level security;

drop policy if exists "own invoice credits" on public.invoice_credits;
create policy "own invoice credits" on public.invoice_credits
  for select to authenticated
  using (owner_id = (select app.uid()));

-- ---------------------------------------------------------------------------
-- 6. checkout_sessions and provider_events
-- ---------------------------------------------------------------------------

create table if not exists public.checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references neon_auth."user" (id) on delete cascade,
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  provider text not null check (provider in ('stripe')),
  mode text not null check (mode in ('test', 'live')),
  external_session_id text not null,
  external_account_id text not null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null,
  status text not null default 'open' check (status in ('open', 'complete', 'expired')),
  url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create unique index if not exists checkout_sessions_external
  on public.checkout_sessions (provider, external_session_id);
create index if not exists checkout_sessions_invoice
  on public.checkout_sessions (invoice_id, status);

alter table public.checkout_sessions enable row level security;

drop policy if exists "own checkout sessions" on public.checkout_sessions;
create policy "own checkout sessions" on public.checkout_sessions
  for select to authenticated
  using (owner_id = (select app.uid()));

-- No policy: only the webhook route (system connection) touches this table.
create table if not exists public.provider_events (
  provider text not null,
  event_id text not null,
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  primary key (provider, event_id)
);

alter table public.provider_events enable row level security;

-- Default privileges (0000) grant authenticated full DML on new tables; RLS
-- already blocks writes (SELECT-only policies), and this makes it explicit.
revoke insert, update, delete on table
  public.payment_connections, public.payments, public.refunds,
  public.invoice_credits, public.checkout_sessions
  from authenticated;
revoke all on table public.provider_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Backfill: invoices already marked paid become one manual payment each,
-- so sum(payments.amount_applied) = invoices.amount_paid holds for every row.
-- ---------------------------------------------------------------------------

insert into public.payments (owner_id, invoice_id, provider, mode, status, amount, currency,
                             amount_applied, reference, paid_at, created_at)
select i.owner_id, i.id, 'manual', 'live', 'succeeded', i.total, i.currency,
       i.total, 'Recorded before the payments ledger', coalesce(i.paid_at, i.updated_at), now()
from public.invoices i
where i.status = 'paid'
  and i.total > 0
  and not exists (select 1 from public.payments p where p.invoice_id = i.id);

update public.invoices
set amount_paid = total
where status = 'paid'
  and amount_paid = 0
  and total > 0;

-- ---------------------------------------------------------------------------
-- 8. Core money functions (internal; not callable by any API role)
-- ---------------------------------------------------------------------------

-- Apply one payment to an invoice. Idempotent on (provider, external_payment_id).
-- Returns {payment_id, public_id, amount_applied, needs_attention, invoice_status, replayed}.
create or replace function public._apply_payment(
  p_invoice_id uuid,
  p_provider text,
  p_mode text,
  p_amount numeric,
  p_currency text,
  p_paid_at timestamptz,
  p_reference text,
  p_external_payment_id text,
  p_checkout_session_id text,
  p_charge_id text,
  p_external_account_id text,
  p_method_type text,
  p_created_by uuid,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_existing public.payments%rowtype;
  v_remaining numeric(14, 2);
  v_applied numeric(14, 2);
  v_attention text;
  v_payment public.payments%rowtype;
  v_now_paid boolean := false;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.' using errcode = 'P0001';
  end if;

  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Replay of a provider payment we already recorded: return it unchanged.
  if p_external_payment_id is not null then
    select * into v_existing from public.payments
    where provider = p_provider and external_payment_id = p_external_payment_id;
    if found then
      return jsonb_build_object(
        'payment_id', v_existing.id, 'public_id', v_existing.public_id,
        'amount_applied', v_existing.amount_applied, 'needs_attention', v_existing.needs_attention,
        'invoice_status', v_invoice.status, 'replayed', true
      );
    end if;
  end if;

  v_remaining := v_invoice.total - v_invoice.amount_credited - v_invoice.amount_paid;

  if upper(p_currency) <> upper(v_invoice.currency) then
    v_applied := 0;
    v_attention := 'currency_mismatch';
  elsif v_invoice.status = 'void' then
    v_applied := 0;
    v_attention := 'invoice_void';
  elsif v_invoice.status = 'paid' or v_remaining <= 0 then
    v_applied := 0;
    v_attention := 'invoice_paid';
  elsif v_invoice.status = 'draft' then
    raise exception 'Only a finalized invoice can be paid.' using errcode = 'P0001';
  elsif p_amount > v_remaining then
    v_applied := v_remaining;
    v_attention := 'overpaid';
  else
    v_applied := p_amount;
  end if;

  insert into public.payments (
    owner_id, invoice_id, provider, mode, status, amount, currency, amount_applied, needs_attention,
    external_payment_id, checkout_session_id, charge_id, external_account_id, method_type,
    reference, paid_at, created_by
  ) values (
    v_invoice.owner_id, v_invoice.id, p_provider, coalesce(p_mode, 'live'), 'succeeded', p_amount,
    upper(p_currency), v_applied, v_attention,
    p_external_payment_id, p_checkout_session_id, p_charge_id, p_external_account_id, p_method_type,
    nullif(p_reference, ''), coalesce(p_paid_at, now()), p_created_by
  )
  returning * into v_payment;

  if v_applied > 0 then
    v_now_paid := (v_invoice.amount_paid + v_applied + v_invoice.amount_credited) >= v_invoice.total;

    update public.invoices
    set amount_paid = amount_paid + v_applied,
        has_test_payments = has_test_payments or (coalesce(p_mode, 'live') = 'test'),
        status = case when v_now_paid then 'paid'::invoice_status else status end,
        paid_at = case when v_now_paid then coalesce(p_paid_at, now()) else paid_at end,
        updated_at = now()
    where id = v_invoice.id;
  elsif coalesce(p_mode, 'live') = 'test' then
    update public.invoices set has_test_payments = true where id = v_invoice.id;
  end if;

  insert into public.invoice_events (invoice_id, type, meta)
  values (v_invoice.id, 'payment_succeeded', coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
    'payment', v_payment.public_id,
    'provider', p_provider,
    'mode', coalesce(p_mode, 'live'),
    'amount', public.to_minor_units(p_amount, v_invoice.currency),
    'amount_applied', public.to_minor_units(v_applied, v_invoice.currency),
    'needs_attention', v_attention,
    'reference', nullif(p_reference, '')
  ));

  if v_now_paid then
    insert into public.invoice_events (invoice_id, type, meta)
    values (v_invoice.id, 'paid', coalesce(p_meta, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'payment', v_payment.public_id,
      'reference', nullif(p_reference, '')
    )));
  end if;

  return jsonb_build_object(
    'payment_id', v_payment.id, 'public_id', v_payment.public_id,
    'amount_applied', v_applied, 'needs_attention', v_attention,
    'invoice_status', case when v_now_paid then 'paid' else v_invoice.status::text end,
    'replayed', false
  );
end;
$$;

-- Refund part or all of a payment. Idempotent on external_refund_id.
-- Money refunded comes first out of any unapplied excess (an overpayment or a
-- payment on a void invoice), then out of what was applied to the invoice.
create or replace function public._apply_refund(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_client_still_owes boolean,
  p_external_refund_id text,
  p_created_by uuid,
  p_meta jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_invoice public.invoices%rowtype;
  v_existing public.refunds%rowtype;
  v_refund public.refunds%rowtype;
  v_unapplied numeric(14, 2);
  v_from_unapplied numeric(14, 2);
  v_from_applied numeric(14, 2);
  v_remaining_after numeric(14, 2);
  v_reopen boolean := false;
  v_credit_id uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Refund amount must be greater than zero.' using errcode = 'P0001';
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Lock the invoice first, then the payment, in the same order as _apply_payment.
  select * into v_invoice from public.invoices where id = v_payment.invoice_id for update;
  select * into v_payment from public.payments where id = p_payment_id for update;

  if p_external_refund_id is not null then
    select * into v_existing from public.refunds where external_refund_id = p_external_refund_id;
    if found then
      return jsonb_build_object('refund_id', v_existing.id, 'public_id', v_existing.public_id, 'replayed', true);
    end if;
  end if;

  if p_amount > v_payment.amount - v_payment.amount_refunded then
    raise exception 'Refund is larger than what is left of this payment.' using errcode = 'P0001';
  end if;

  v_unapplied := v_payment.amount - v_payment.amount_applied - v_payment.amount_refunded;
  if v_unapplied < 0 then v_unapplied := 0; end if;
  v_from_unapplied := least(p_amount, v_unapplied);
  v_from_applied := p_amount - v_from_unapplied;

  insert into public.refunds (owner_id, payment_id, invoice_id, amount, reason, client_still_owes,
                              external_refund_id, created_by)
  values (v_payment.owner_id, v_payment.id, v_invoice.id, p_amount, nullif(p_reason, ''),
          coalesce(p_client_still_owes, false), p_external_refund_id, p_created_by)
  returning * into v_refund;

  update public.payments
  set amount_refunded = amount_refunded + p_amount,
      amount_applied = amount_applied - v_from_applied,
      status = case when amount_refunded + p_amount >= amount then 'refunded' else 'partially_refunded' end,
      updated_at = now()
  where id = v_payment.id;

  if v_from_applied > 0 then
    if coalesce(p_client_still_owes, false) then
      -- The client owes this again: the balance reopens.
      v_remaining_after := v_invoice.total - v_invoice.amount_credited - (v_invoice.amount_paid - v_from_applied);
      v_reopen := v_invoice.status = 'paid' and v_remaining_after > 0;

      update public.invoices
      set amount_paid = amount_paid - v_from_applied,
          status = case when v_reopen then 'open'::invoice_status else status end,
          paid_at = case when v_reopen then null else paid_at end,
          updated_at = now()
      where id = v_invoice.id;
    else
      -- Nothing is owed any more: record an equal credit so the invoice stays settled.
      insert into public.invoice_credits (owner_id, invoice_id, amount, reason, refund_id, created_by)
      values (v_invoice.owner_id, v_invoice.id, v_from_applied, nullif(p_reason, ''), v_refund.id, p_created_by)
      returning id into v_credit_id;

      update public.invoices
      set amount_paid = amount_paid - v_from_applied,
          amount_credited = amount_credited + v_from_applied,
          updated_at = now()
      where id = v_invoice.id;
    end if;
  end if;

  insert into public.invoice_events (invoice_id, type, meta)
  values (v_invoice.id, 'refunded', coalesce(p_meta, '{}'::jsonb) || jsonb_build_object(
    'refund', v_refund.public_id,
    'payment', v_payment.public_id,
    'amount', public.to_minor_units(p_amount, v_invoice.currency),
    'client_still_owes', coalesce(p_client_still_owes, false),
    'reason', nullif(p_reason, '')
  ));

  if v_credit_id is not null then
    insert into public.invoice_events (invoice_id, type, meta)
    values (v_invoice.id, 'credited', jsonb_build_object(
      'refund', v_refund.public_id,
      'amount', public.to_minor_units(v_from_applied, v_invoice.currency)
    ));
  end if;

  return jsonb_build_object(
    'refund_id', v_refund.id, 'public_id', v_refund.public_id,
    'invoice_reopened', v_reopen, 'credited', v_credit_id is not null, 'replayed', false
  );
end;
$$;

revoke all on function public._apply_payment(uuid, text, text, numeric, text, timestamptz, text, text, text, text, text, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public._apply_refund(uuid, numeric, text, boolean, text, uuid, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. Wrappers for signed-in merchants (dashboard, API keys, MCP)
--
-- These check ownership with app.uid() and only allow provider 'manual'.
-- Provider payments arrive through the webhook route on the system connection,
-- which calls the core functions directly.
-- ---------------------------------------------------------------------------

create or replace function public.record_manual_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_paid_at timestamptz,
  p_reference text,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices%rowtype;
  v_amount numeric(14, 2);
begin
  select * into v_invoice from public.invoices
  where id = p_invoice_id and owner_id = app.uid();
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if v_invoice.status <> 'open' then
    raise exception 'Invoice is % and cannot take a payment.', v_invoice.status using errcode = 'P0001';
  end if;

  -- No amount means "the whole balance", which keeps POST /pay's old meaning.
  v_amount := coalesce(p_amount, v_invoice.total - v_invoice.amount_credited - v_invoice.amount_paid);

  if v_amount > v_invoice.total - v_invoice.amount_credited - v_invoice.amount_paid then
    raise exception 'Payment is larger than the balance due.' using errcode = 'P0001';
  end if;

  return public._apply_payment(
    p_invoice_id, 'manual', 'live', v_amount, v_invoice.currency, p_paid_at, p_reference,
    null, null, null, null, 'manual', app.uid(), p_meta
  );
end;
$$;

create or replace function public.refund_manual_payment(
  p_payment_id uuid,
  p_amount numeric,
  p_reason text,
  p_client_still_owes boolean,
  p_meta jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.payments
    where id = p_payment_id and owner_id = app.uid() and provider = 'manual'
  ) then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  return public._apply_refund(p_payment_id, p_amount, p_reason, p_client_still_owes, null, app.uid(), p_meta);
end;
$$;

revoke all on function public.record_manual_payment(uuid, numeric, timestamptz, text, jsonb) from public, anon;
grant execute on function public.record_manual_payment(uuid, numeric, timestamptz, text, jsonb) to authenticated;
revoke all on function public.refund_manual_payment(uuid, numeric, text, boolean, jsonb) from public, anon;
grant execute on function public.refund_manual_payment(uuid, numeric, text, boolean, jsonb) to authenticated;

comment on function public.record_manual_payment(uuid, numeric, timestamptz, text, jsonb) is
  'Records a payment received outside Invoice-AI (bank transfer, cash). Null amount = the whole balance.';
comment on function public.refund_manual_payment(uuid, numeric, text, boolean, jsonb) is
  'Records money returned for a manual payment; client_still_owes decides between reopening and crediting.';

-- ---------------------------------------------------------------------------
-- 10. Voiding: an invoice that holds money must be refunded first
-- ---------------------------------------------------------------------------

alter table public.invoices drop constraint if exists invoices_void_without_money;
alter table public.invoices
  add constraint invoices_void_without_money check (status <> 'void' or amount_paid = 0);

-- ---------------------------------------------------------------------------
-- 11. Webhook payload: the Invoice object gains the payment fields
-- (same body as 0014 plus amount_paid / amount_credited / amount_remaining /
-- payment_options; amount_due is now the remaining balance)
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
           end as status,
           greatest(i.total - i.amount_credited - i.amount_paid, 0) as remaining
  ) s
  cross join lateral (
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
      'amount_paid', public.to_minor_units(i.amount_paid, i.currency),
      'amount_credited', public.to_minor_units(i.amount_credited, i.currency),
      'amount_remaining', public.to_minor_units(s.remaining, i.currency),
      'amount_due', case
        when s.status in ('open', 'overdue') then public.to_minor_units(s.remaining, i.currency)
        else 0
      end,
      'payment_options', i.payment_options,
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
    and (cardinality(e.events) = 0 or v_event_name = any (e.events));

  return new;
end;
$$;

comment on function public.enqueue_webhook_deliveries() is
  'Outbox trigger on invoice_events: queues one delivery per subscribed endpoint. '
  'Payload v2 (0014) + payment fields (0017).';
