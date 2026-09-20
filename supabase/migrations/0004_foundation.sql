-- Foundation for the public API.
--
-- Nothing here adds a feature a user can see. It closes the correctness gaps
-- that only matter once something *other than a browser* can call us.
--
-- A person clicks "Send" once and waits. A program retries on timeout, runs two
-- requests in parallel, and gives up halfway through. Three of the four changes
-- below exist because of that difference:
--
--   * issue_invoice()        — claiming a GST number and saving it must be ONE
--                              step, or a retry burns a number and leaves a gap
--                              in a series that GST law requires to be
--                              consecutive.
--   * replace_invoice_items() — swapping line items must be ONE step, or a
--                              failure between the delete and the insert leaves
--                              an invoice with no items.
--   * event type additions   — the API needs to describe cancellation, edits and
--                              email outcomes as distinct things that happened.
--
-- Ordering note: the ALTER TYPE ... ADD VALUE statements come first and are not
-- used anywhere else in this file. Postgres allows adding an enum value inside a
-- transaction, but not *using* it in the same transaction.

-- ---------------------------------------------------------------------------
-- Event vocabulary
--
-- Today the enum is (created, sent, viewed, downloaded, paid), and `sent` is
-- doing two jobs: "got its number" and "the email went out". Those are separate
-- events for an integrator — an invoice can be legally issued and never emailed
-- — so they get separate names.
--
-- `sent` is kept as-is rather than renamed. It is written to existing rows, and
-- the API translates it to `invoice.issued` at the edge.
-- ---------------------------------------------------------------------------

alter type invoice_event_type add value if not exists 'updated';
alter type invoice_event_type add value if not exists 'emailed';
alter type invoice_event_type add value if not exists 'email_failed';
alter type invoice_event_type add value if not exists 'cancelled';

-- ---------------------------------------------------------------------------
-- Cancellation and archiving
--
-- `cancelled` already exists in invoice_status but nothing ever writes it.
-- An issued invoice can never be deleted — the number has to stay accounted
-- for — so cancelling, with a reason on the record, is the only way out.
--
-- Clients are archived rather than deleted for the same reason: issued invoices
-- reference them.
-- ---------------------------------------------------------------------------

alter table public.invoices
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

comment on column public.invoices.cancel_reason is
  'Why the invoice was cancelled. Required by the service layer; an audit asks.';

alter table public.clients
  add column if not exists archived_at timestamptz;

comment on column public.clients.archived_at is
  'Soft delete. Issued invoices reference clients, so rows are never removed.';

-- ---------------------------------------------------------------------------
-- GST Rule 46: an invoice number is at most 16 characters.
--
-- claim_invoice_number builds PREFIX/YY-YY/0001. The tail after the prefix is
-- 11 characters, which leaves 5. The app currently allows a 10-character prefix,
-- so a compliant-looking setup can produce a 21-character, non-compliant number.
--
-- NOT VALID on purpose: existing rows are left alone (changing a business's
-- prefix retroactively would not change invoices already issued under it), but
-- every insert and update from here on is checked.
-- ---------------------------------------------------------------------------

alter table public.businesses
  drop constraint if exists businesses_prefix_length;

alter table public.businesses
  add constraint businesses_prefix_length
  check (char_length(invoice_prefix) <= 5) not valid;

-- ---------------------------------------------------------------------------
-- Atomic issue
--
-- The bug this replaces, in lib/actions/send.ts:
--
--   1. read the invoice
--   2. rpc claim_invoice_number()   -- commits, business counter now +1
--   3. UPDATE invoices SET invoice_number = ...   -- a SEPARATE statement
--
-- Two requests arriving together both pass step 1, both claim at step 2 (the
-- counter goes +2), and at step 3 the second overwrites the first. One number
-- is now assigned to nothing: a permanent gap.
--
-- Here, the row lock at the top makes the second caller WAIT. By the time it
-- proceeds, the invoice already has a number, so it returns that same number
-- and claims nothing. The counter advances exactly once.
--
-- This is also the database-level half of API idempotency: even if the
-- application's Idempotency-Key handling is bypassed entirely, issuing twice
-- cannot produce two numbers.
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
  -- FOR UPDATE is the whole point of this function. A concurrent call blocks
  -- here until this transaction commits, instead of racing past.
  select * into v_invoice
  from public.invoices
  where id = p_invoice_id and owner_id = auth.uid()
  for update;

  if not found then
    -- P0002 = no_data_found. The service layer maps it to a 404, which is also
    -- what another owner's id returns: we never confirm a row exists.
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  -- Already issued: hand back the same number. Idempotent by construction.
  if v_invoice.invoice_number is not null then
    return v_invoice.invoice_number;
  end if;

  if v_invoice.status <> 'draft' then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- An invoice with no line items has a zero total and no legal meaning.
  -- Better to refuse than to spend a number on it.
  select count(*) into v_items
  from public.invoice_items
  where invoice_id = p_invoice_id;

  if v_items = 0 then
    raise exception 'invalid_state' using errcode = 'P0001';
  end if;

  -- Same transaction as the UPDATE below: claim and save commit together.
  v_number := public.claim_invoice_number(v_invoice.business_id);

  update public.invoices
  set invoice_number = v_number,
      status = 'sent',
      sent_at = now()
  where id = p_invoice_id;

  insert into public.invoice_events (invoice_id, type, meta)
  values (p_invoice_id, 'sent', coalesce(p_meta, '{}'::jsonb));

  return v_number;
end;
$$;

comment on function public.issue_invoice(uuid, jsonb) is
  'Assigns a GST invoice number and marks the invoice issued, atomically. '
  'Returns the existing number if already issued.';

revoke all on function public.issue_invoice(uuid, jsonb) from public;
revoke execute on function public.issue_invoice(uuid, jsonb) from anon;
grant execute on function public.issue_invoice(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic line-item replacement
--
-- saveInvoiceDraft deletes every item then re-inserts them, as two round trips,
-- with the delete's error ignored. Lose the connection in between and the draft
-- is left with no items at all.
--
-- One statement pair inside one function is one transaction: either the new set
-- lands or the old set is untouched.
--
-- Drafts only. Items under an issued invoice are frozen — the PDF a client
-- received has to keep matching the record.
-- ---------------------------------------------------------------------------

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
    discount_percent, taxable_value, gst_rate, cgst_amount, sgst_amount,
    igst_amount, cess_rate, cess_amount, line_total
  )
  select
    p_invoice_id, it."position", it.description, it.hsn_sac, it.quantity,
    coalesce(it.unit, 'NOS'), it.rate, coalesce(it.discount_percent, 0),
    it.taxable_value, it.gst_rate, it.cgst_amount, it.sgst_amount,
    it.igst_amount, coalesce(it.cess_rate, 0), it.cess_amount, it.line_total
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as it(
    "position"       integer,
    description      text,
    hsn_sac          text,
    quantity         numeric,
    unit             text,
    rate             numeric,
    discount_percent numeric,
    taxable_value    numeric,
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

comment on function public.replace_invoice_items(uuid, jsonb) is
  'Replaces every line item on a draft invoice in one transaction. Returns the row count.';

revoke all on function public.replace_invoice_items(uuid, jsonb) from public;
revoke execute on function public.replace_invoice_items(uuid, jsonb) from anon;
grant execute on function public.replace_invoice_items(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Keep the public event log consistent with the public read
--
-- get_public_invoice already hides cancelled invoices, but
-- log_public_invoice_event still records views against them. The two disagreed:
-- a cancelled invoice could accumulate "viewed" events for a page that returns
-- nothing. Only the status filter changes.
-- ---------------------------------------------------------------------------

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
    and status <> 'cancelled';

  if v_invoice_id is null then
    return;
  end if;

  insert into public.invoice_events (invoice_id, type)
  values (v_invoice_id, p_type);
end;
$$;

-- Unchanged from 0001: this one IS the public surface and stays open to anon.
revoke all on function public.log_public_invoice_event(uuid, invoice_event_type) from public;
grant execute on function public.log_public_invoice_event(uuid, invoice_event_type) to anon, authenticated;
