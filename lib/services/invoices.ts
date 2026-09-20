import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, invalidState, notFound, ServiceError, upstreamFailed } from '@/lib/services/errors'
import { decodeCursor, encodeCursor, type Page } from '@/lib/services/pagination'
import * as businesses from '@/lib/services/business'
import { invoiceSchema, type InvoiceInput } from '@/lib/validators'
import { computeInvoice, type TaxLineInput } from '@/lib/tax'
import { paiseToStored } from '@/lib/money-api'
import { snapshotBusiness } from '@/lib/invoice-view'
import { viewFromRows } from '@/lib/invoice-load'
import { deriveStatus } from '@/lib/invoice-status'
import { renderInvoicePdf, pdfFilename } from '@/lib/pdf'
import { sendInvoiceEmail } from '@/lib/email'
import { publicInvoiceUrl } from '@/lib/urls'
import type { InvoiceEventRow, InvoiceItemRow, InvoiceRow, InvoiceStatus } from '@/lib/database.types'

/**
 * The invoice rules, in one place.
 *
 * The state machine every function below defends:
 *
 *     [*] ──createDraft──► draft ──issue──► sent ──markPaid──► paid
 *                           │  ▲             │
 *                    updateDraft         cancel
 *                           │                ▼
 *                        deleteDraft     cancelled
 *
 * Two things that look like omissions and aren't:
 *
 *  * There is no transition out of `paid` or `cancelled`. Cancelling a paid
 *    invoice needs a credit note, not a status flip.
 *  * `overdue` never appears. It is derived from `due_date` at read time by
 *    lib/invoice-status.ts, so it is never a row you can be in — which is why
 *    markPaid filters on `sent` and still works for an overdue invoice.
 */

export interface InvoiceWithItems {
  invoice: InvoiceRow
  items: InvoiceItemRow[]
  /** `status` with overdue applied. The stored column is never `overdue`. */
  derivedStatus: InvoiceStatus
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListInvoicesOptions {
  status?: InvoiceStatus
  clientId?: string
  /** Inclusive ISO date bounds on issue_date. */
  from?: string
  to?: string
  cursor?: string | null
  limit?: number
}

export async function list(ctx: AuthContext, options: ListInvoicesOptions = {}): Promise<Page<InvoiceRow>> {
  requireScope(ctx, 'invoices:read')

  const limit = clampLimit(options.limit)

  let q = ctx.supabase
    .from('invoices')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  // `overdue` is derived, so it can't be a WHERE clause. Ask the database for
  // issued invoices and narrow afterwards, otherwise filtering by overdue
  // silently returns nothing.
  if (options.status && options.status !== 'overdue') q = q.eq('status', options.status)
  if (options.status === 'overdue') q = q.eq('status', 'sent')

  if (options.clientId) q = q.eq('client_id', options.clientId)
  if (options.from) q = q.gte('issue_date', options.from)
  if (options.to) q = q.lte('issue_date', options.to)

  const after = decodeCursor(options.cursor)
  if (after) {
    q = q.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`)
  }

  const { data, error } = await q
  if (error) throw fromPostgres(error)

  let rows = (data ?? []) as InvoiceRow[]
  if (options.status === 'overdue') {
    rows = rows.filter((row) => deriveStatus(row) === 'overdue')
  }

  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const last = page.at(-1)

  return {
    data: page,
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}

export async function get(ctx: AuthContext, id: string): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:read')
  return load(ctx, id)
}

export async function events(ctx: AuthContext, id: string): Promise<InvoiceEventRow[]> {
  requireScope(ctx, 'invoices:read')

  // Confirms the invoice is ours before returning its history. Without this,
  // an unknown id would return an empty array rather than a 404.
  await load(ctx, id)

  const { data, error } = await ctx.supabase
    .from('invoice_events')
    .select('*')
    .eq('invoice_id', id)
    .order('created_at', { ascending: false })

  if (error) throw fromPostgres(error)
  return (data ?? []) as InvoiceEventRow[]
}

export async function pdf(ctx: AuthContext, id: string): Promise<{ buffer: Buffer; filename: string }> {
  requireScope(ctx, 'invoices:read')

  const { invoice, items } = await load(ctx, id)
  const view = viewFromRows(invoice, items)

  return { buffer: await renderInvoicePdf(view), filename: pdfFilename(view) }
}

// ---------------------------------------------------------------------------
// Draft writes
// ---------------------------------------------------------------------------

export async function createDraft(ctx: AuthContext, input: InvoiceInput): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  return writeDraft(ctx, input, undefined)
}

export async function updateDraft(
  ctx: AuthContext,
  id: string,
  input: InvoiceInput,
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  return writeDraft(ctx, input, id)
}

/**
 * Delete a draft.
 *
 * Only a draft. An issued invoice holds a number in a consecutive series —
 * deleting it would leave a gap that an audit reads as a hidden sale.
 * `cancel` is the only way to retire an issued invoice, and it keeps the
 * number on the record.
 */
export async function deleteDraft(ctx: AuthContext, id: string): Promise<void> {
  requireScope(ctx, 'invoices:write')

  const { invoice } = await load(ctx, id)

  if (invoice.status !== 'draft') {
    throw invalidState(
      `Invoice ${invoice.invoice_number ?? id} has been issued and cannot be deleted. Cancel it instead.`,
    )
  }

  const { error } = await ctx.supabase.from('invoices').delete().eq('id', id).eq('status', 'draft')
  if (error) throw fromPostgres(error)
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Assign an invoice number.
 *
 * All the real work is in the `issue_invoice` RPC, which takes a row lock so two
 * concurrent calls cannot both claim a number. Calling it twice returns the same
 * number rather than erroring, which is what makes a retry safe even if the
 * Idempotency-Key layer above is bypassed entirely.
 */
export async function issue(ctx: AuthContext, id: string): Promise<{ invoiceNumber: string }> {
  requireScope(ctx, 'invoices:issue')

  // Surfaces a 404 for an unknown id before the RPC turns it into P0002.
  await load(ctx, id)

  const { data, error } = await ctx.supabase.rpc('issue_invoice', {
    p_invoice_id: id,
    p_meta: actorMeta(ctx),
  })

  if (error) throw fromPostgres(error)
  if (!data) throw upstreamFailed('Could not assign an invoice number.')

  return { invoiceNumber: data }
}

/**
 * Email the invoice to the client.
 *
 * Issues it first if it hasn't been. The alternative — refusing to send a draft
 * — would make "invoice Acme and email it" two calls that can fail between,
 * leaving a numbered invoice nobody sent.
 *
 * The email is deliberately allowed to fail *after* issuing. Rolling back an invoice
 * number because a mail provider had a bad minute would be worse: the number is
 * already spent, and unwinding it breaks the consecutive series.
 */
export async function send(
  ctx: AuthContext,
  id: string,
  options: { to?: string } = {},
): Promise<{ emailed: boolean; publicUrl: string; invoiceNumber: string }> {
  requireScope(ctx, 'invoices:send')

  const existing = await load(ctx, id)

  if (existing.invoice.status === 'cancelled') {
    throw invalidState('This invoice was cancelled and cannot be sent.')
  }
  if (!existing.items.length) {
    throw invalidState('Add at least one line item before sending.')
  }

  const invoiceNumber = existing.invoice.invoice_number ?? (await issueForSend(ctx, id))
  const { invoice, items } = await load(ctx, id)

  const view = viewFromRows(invoice, items)
  const recipient = options.to || view.client.email
  const publicUrl = publicInvoiceUrl(invoice.public_token)

  if (!recipient) {
    throw new ServiceError('validation', 'No client email address to send to.', [
      { path: 'to', message: 'Provide a recipient, or set an email on the client.' },
    ])
  }

  try {
    const buffer = await renderInvoicePdf(view)
    await sendInvoiceEmail({
      to: recipient,
      view,
      publicUrl,
      pdf: buffer,
      filename: pdfFilename(view),
    })
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : 'Could not send the email.'
    await writeEvent(ctx, id, 'email_failed', { to: recipient, error: message })
    throw upstreamFailed(`Invoice issued, but the email failed: ${message}`)
  }

  await writeEvent(ctx, id, 'emailed', { to: recipient })

  return { emailed: true, publicUrl, invoiceNumber }
}

/**
 * `invoices:send` implies issuing, because you cannot email an unnumbered
 * invoice. The scope check is skipped here on purpose — requiring both
 * `invoices:issue` and `invoices:send` to send one email would make the
 * narrower-looking scope useless on its own.
 */
async function issueForSend(ctx: AuthContext, id: string): Promise<string> {
  const { data, error } = await ctx.supabase.rpc('issue_invoice', {
    p_invoice_id: id,
    p_meta: actorMeta(ctx),
  })

  if (error) throw fromPostgres(error)
  if (!data) throw upstreamFailed('Could not assign an invoice number.')

  return data
}

export async function markPaid(
  ctx: AuthContext,
  id: string,
  options: { paidOn?: string; reference?: string } = {},
): Promise<InvoiceRow> {
  requireScope(ctx, 'payments:write')

  const { data, error } = await ctx.supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: options.paidOn ?? new Date().toISOString() })
    .eq('id', id)
    // Not `.neq('draft')`. That let a cancelled invoice be flipped to paid.
    .eq('status', 'sent')
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)

  // Nothing changed. Work out why, so the caller gets a 404 or a 409 rather
  // than a success that did nothing.
  if (!data) {
    const { invoice } = await load(ctx, id)
    throw invalidState(`Invoice is ${invoice.status} and cannot be marked paid.`)
  }

  await writeEvent(ctx, id, 'paid', {
    ...actorMeta(ctx),
    ...(options.reference ? { reference: options.reference } : {}),
  })

  return data as InvoiceRow
}

/**
 * Cancel an issued invoice.
 *
 * The number stays on the row. That is the whole point — a cancelled invoice is
 * still part of the series, and an auditor seeing 0041, 0043 wants to find 0042
 * marked cancelled with a reason, not missing.
 */
export async function cancel(ctx: AuthContext, id: string, options: { reason: string }): Promise<InvoiceRow> {
  requireScope(ctx, 'invoices:issue')

  const reason = options.reason?.trim()
  if (!reason) {
    throw new ServiceError('validation', 'A cancellation reason is required.', [
      { path: 'reason', message: 'Say why this invoice was cancelled.' },
    ])
  }

  const { data, error } = await ctx.supabase
    .from('invoices')
    .update({ status: 'cancelled', cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq('id', id)
    .eq('status', 'sent')
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)

  if (!data) {
    const { invoice } = await load(ctx, id)
    throw invalidState(
      invoice.status === 'paid'
        ? 'A paid invoice needs a credit note, not a cancellation.'
        : `Invoice is ${invoice.status} and cannot be cancelled.`,
    )
  }

  await writeEvent(ctx, id, 'cancelled', { ...actorMeta(ctx), reason })

  return data as InvoiceRow
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function load(ctx: AuthContext, id: string): Promise<InvoiceWithItems> {
  const { data: invoice, error } = await ctx.supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!invoice) throw notFound('Invoice not found.')

  const { data: items, error: itemsError } = await ctx.supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('position', { ascending: true })

  if (itemsError) throw fromPostgres(itemsError)

  const row = invoice as InvoiceRow

  return {
    invoice: row,
    items: (items ?? []) as InvoiceItemRow[],
    derivedStatus: deriveStatus(row),
  }
}

/**
 * Create or update a draft.
 *
 * Every total is recomputed from the submitted line items by `computeInvoice`.
 * Anything the caller claimed about tax is ignored — an integration cannot
 * produce a document whose tax doesn't follow from its own lines.
 */
async function writeDraft(
  ctx: AuthContext,
  input: InvoiceInput,
  id: string | undefined,
): Promise<InvoiceWithItems> {
  const parsed = invoiceSchema.safeParse(input)
  if (!parsed.success) {
    throw new ServiceError(
      'validation',
      'Some fields need attention.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }

  const data = parsed.data
  const business = await businesses.getPrimary(ctx)

  // Check state up front rather than relying on a filter in the UPDATE. The
  // line items are replaced by a separate call, so a filter on the header alone
  // would let an issued invoice's items change while its totals stayed frozen.
  let existingClientId: string | null = null

  if (id) {
    const { invoice } = await load(ctx, id)
    if (invoice.status !== 'draft') {
      throw invalidState('This invoice has been issued and can no longer be edited.')
    }
    existingClientId = invoice.client_id
  }

  const lines: TaxLineInput[] = data.items.map((item) => ({
    description: item.description,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    discountPercent: item.discount_percent,
    taxRate: item.tax_rate,
  }))

  const computed = computeInvoice({ lines }, data.currency)

  const clientValues = {
    owner_id: ctx.userId,
    name: data.client.name,
    tax_id: data.client.tax_id || null,
    email: data.client.email || null,
    phone: data.client.phone ?? null,
    address_line1: data.client.address_line1 ?? null,
    address_line2: data.client.address_line2 ?? null,
    city: data.client.city ?? null,
    region: data.client.region || null,
    postal_code: data.client.postal_code || null,
    country_code: data.client.country_code || null,
    country: data.client.country ?? data.client.country_code ?? '',
  }

  // Reuse the row this draft already points at, so editing doesn't leave a
  // trail of near-identical clients behind.
  let clientId = existingClientId

  if (clientId) {
    const { error } = await ctx.supabase.from('clients').update(clientValues).eq('id', clientId)
    if (error) throw fromPostgres(error)
  } else {
    const { data: created, error } = await ctx.supabase
      .from('clients')
      .insert(clientValues)
      .select('id')
      .single()
    if (error) throw fromPostgres(error)
    clientId = created.id
  }

  const invoiceValues = {
    owner_id: ctx.userId,
    business_id: business.id,
    client_id: clientId,
    status: 'draft' as const,
    issue_date: data.issue_date,
    due_date: data.due_date || null,
    currency: data.currency,
    place_of_supply_state_code: null,
    is_export: false,
    reverse_charge: false,
    notes: data.notes ?? null,
    terms: data.terms ?? null,
    business_snapshot: snapshotBusiness(business),
    client_snapshot: { ...clientValues, owner_id: undefined },
    subtotal: paiseToStored(computed.subtotalMinor),
    discount_total: paiseToStored(computed.discountTotalMinor),
    taxable_total: paiseToStored(computed.taxableTotalMinor),
    tax_total: paiseToStored(computed.taxTotalMinor),
    cgst_total: 0,
    sgst_total: 0,
    igst_total: paiseToStored(computed.taxTotalMinor),
    cess_total: 0,
    round_off: 0,
    total: paiseToStored(computed.totalMinor),
    amount_in_words: computed.amountInWords,
  }

  let invoiceId = id

  if (invoiceId) {
    const { error } = await ctx.supabase
      .from('invoices')
      .update(invoiceValues)
      .eq('id', invoiceId)
      .eq('status', 'draft')
    if (error) throw fromPostgres(error)
  } else {
    const { data: created, error } = await ctx.supabase
      .from('invoices')
      .insert(invoiceValues)
      .select('id')
      .single()
    if (error) throw fromPostgres(error)
    invoiceId = created.id
  }

  // One transaction: either the new set of items lands or the old one is
  // untouched. The previous delete-then-insert could leave neither.
  const { error: itemsError } = await ctx.supabase.rpc('replace_invoice_items', {
    p_invoice_id: invoiceId!,
    p_items: computed.lines.map((line, index) => ({
      position: index,
      description: line.description,
      hsn_sac: null,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      discount_percent: line.discountPercent,
      taxable_value: paiseToStored(line.taxableMinor),
      tax_rate: line.taxRate,
      tax_amount: paiseToStored(line.taxMinor),
      gst_rate: line.taxRate,
      cgst_amount: 0,
      sgst_amount: 0,
      igst_amount: paiseToStored(line.taxMinor),
      cess_rate: 0,
      cess_amount: 0,
      line_total: paiseToStored(line.totalMinor),
    })),
  })

  if (itemsError) throw fromPostgres(itemsError)

  await writeEvent(ctx, invoiceId!, id ? 'updated' : 'created', actorMeta(ctx))

  return load(ctx, invoiceId!)
}

/**
 * Who did this.
 *
 * Stamped onto every event so "an AI assistant cancelled this invoice" has an
 * answer before the full API audit log exists.
 */
function actorMeta(ctx: AuthContext): Record<string, string> {
  return {
    actor: ctx.via,
    request_id: ctx.requestId,
    ...(ctx.apiKeyId ? { api_key_id: ctx.apiKeyId } : {}),
    ...(ctx.clientId ? { client_id: ctx.clientId } : {}),
  }
}

async function writeEvent(
  ctx: AuthContext,
  invoiceId: string,
  type: InvoiceEventRow['type'],
  meta: Record<string, unknown>,
): Promise<void> {
  // An event that fails to write must not fail the operation it describes —
  // the invoice is already issued. Webhooks hang off this table, so a dropped
  // row means a missed delivery, which is why it is logged rather than ignored.
  const { error } = await ctx.supabase
    .from('invoice_events')
    .insert({ invoice_id: invoiceId, type, meta: meta as never })

  if (error) {
    console.error('[invoice_events] failed to record %s for %s: %s', type, invoiceId, error.message)
  }
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}
