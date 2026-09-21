import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, invalidState, notFound, ServiceError, upstreamFailed } from '@/lib/services/errors'
import { decodeCursor, encodeCursor, type Page } from '@/lib/services/pagination'
import * as businesses from '@/lib/services/business'
import { get as getClient, rowToInput as clientRowToInput } from '@/lib/services/clients'
import { invoiceSchema, emptyClientInput, type InvoiceInput, type InvoiceWireInput } from '@/lib/validators'
import { computeInvoice, type TaxLineInput } from '@/lib/tax'
import { paiseToStored } from '@/lib/money-api'
import { getManyWithProducts } from '@/lib/services/prices'
import { isInvoiceId, isInvoiceItemId, nextCustomerId, nextInvoiceId, nextInvoiceItemId } from '@/lib/catalog/ids'
import { resolvePricedLines, type CatalogPrice, type ResolvedLine } from '@/lib/catalog/resolve'
import { snapshotBusiness } from '@/lib/invoice-view'
import { viewFromRows } from '@/lib/invoice-load'
import { deriveStatus } from '@/lib/invoice-status'
import { renderInvoicePdf, pdfFilename } from '@/lib/pdf'
import { sendInvoiceEmail } from '@/lib/email'
import { publicInvoiceUrl } from '@/lib/urls'
import type { ClientRow, InvoiceEventRow, InvoiceItemRow, InvoiceRow, InvoiceStatus } from '@/lib/database.types'

/**
 * The invoice rules, in one place.
 *
 * The state machine every function below defends (Stripe verbs):
 *
 *     [*] ──createDraft──► draft ──finalize──► open ──pay──► paid
 *                           │  ▲               │
 *                    updateDraft             void
 *                           │                  ▼
 *                        deleteDraft          void
 *
 * Two things that look like omissions and aren't:
 *
 *  * There is no transition out of `paid` or `void`. Voiding a paid
 *    invoice needs a credit note, not a status flip.
 *  * `overdue` never appears. It is derived from `due_date` at read time by
 *    lib/invoice-status.ts, so it is never a row you can be in — which is why
 *    pay filters on `open` and still works for an overdue invoice.
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
  if (options.status === 'overdue') q = q.eq('status', 'open')

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
  const { invoice: eventInvoice } = await load(ctx, id)

  const { data, error } = await ctx.supabase
    .from('invoice_events')
    .select('*')
    .eq('invoice_id', eventInvoice.id)
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
 * Reference maps for serializing one invoice Stripe-style.
 *
 * Internal UUIDs never leave the API: the customer, prices and products are
 * named by their `cus_…` / `price_…` / `prod_…` public IDs.
 */
export interface InvoiceCatalogRefs {
  customerPublicId: string | null
  pricePublicById: Map<string, string>
  productPublicById: Map<string, string>
}

export async function refsForInvoice(
  ctx: AuthContext,
  invoice: InvoiceRow,
  items: InvoiceItemRow[],
): Promise<InvoiceCatalogRefs> {
  const customerPublicId = invoice.client_id
    ? ((await customerMap(ctx, [invoice.client_id])).get(invoice.client_id) ?? null)
    : null

  const priceIds = [...new Set(items.map((i) => i.price_id).filter((v): v is string => Boolean(v)))]
  const productIds = [...new Set(items.map((i) => i.product_id).filter((v): v is string => Boolean(v)))]

  const pricePublicById = new Map<string, string>()
  if (priceIds.length > 0) {
    const { data } = await ctx.supabase.from('prices').select('id, public_id').in('id', priceIds)
    for (const row of (data ?? []) as Array<{ id: string; public_id: string }>) {
      pricePublicById.set(row.id, row.public_id)
    }
  }

  const productPublicById = new Map<string, string>()
  if (productIds.length > 0) {
    const { data } = await ctx.supabase.from('products').select('id, public_id').in('id', productIds)
    for (const row of (data ?? []) as Array<{ id: string; public_id: string }>) {
      productPublicById.set(row.id, row.public_id)
    }
  }

  return { customerPublicId, pricePublicById, productPublicById }
}

/** Client UUID → `cus_…` for a batch of invoices. Used by list serialization. */
export async function customerMap(
  ctx: AuthContext,
  clientIds: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = [...new Set(clientIds.filter((v): v is string => Boolean(v)))]
  const map = new Map<string, string>()
  if (unique.length === 0) return map

  const { data } = await ctx.supabase.from('clients').select('id, public_id').in('id', unique)
  for (const row of (data ?? []) as Array<{ id: string; public_id: string }>) {
    map.set(row.id, row.public_id)
  }
  return map
}

/**
 * Delete a draft.
 *
 * Only a draft. A finalized invoice holds a number in a consecutive series —
 * deleting it would leave a gap that an audit reads as a hidden sale.
 * `void` is the only way to retire a finalized invoice, and it keeps the
 * number on the record.
 */
export async function deleteDraft(ctx: AuthContext, id: string): Promise<void> {
  requireScope(ctx, 'invoices:write')

  const { invoice } = await load(ctx, id)

  if (invoice.status !== 'draft') {
    throw invalidState(
      `Invoice ${invoice.invoice_number ?? id} has been finalized and cannot be deleted. Void it instead.`,
    )
  }

  const { error } = await ctx.supabase.from('invoices').delete().eq('id', invoice.id).eq('status', 'draft')
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
export async function finalize(ctx: AuthContext, id: string): Promise<{ invoiceNumber: string }> {
  requireScope(ctx, 'invoices:finalize')

  // Surfaces a 404 for an unknown id before the RPC turns it into P0002.
  const { invoice: draftInvoice } = await load(ctx, id)

  const { data, error } = await ctx.supabase.rpc('issue_invoice', {
    p_invoice_id: draftInvoice.id,
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

  if (existing.invoice.status === 'void') {
    throw invalidState('This invoice is void and cannot be sent.')
  }
  if (!existing.items.length) {
    throw invalidState('Add at least one line item before sending.')
  }

  const invoiceId = existing.invoice.id
  const invoiceNumber = existing.invoice.invoice_number ?? (await finalizeForSend(ctx, invoiceId))
  const { invoice, items } = await load(ctx, invoiceId)

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
    await writeEvent(ctx, invoiceId, 'email_failed', { to: recipient, error: message })
    throw upstreamFailed(`Invoice finalized, but the email failed: ${message}`)
  }

  await writeEvent(ctx, invoiceId, 'emailed', { to: recipient })

  return { emailed: true, publicUrl, invoiceNumber }
}

/**
 * `invoices:send` implies issuing, because you cannot email an unnumbered
 * invoice. The scope check is skipped here on purpose — requiring both
 * `invoices:finalize` and `invoices:send` to send one email would make the
 * narrower-looking scope useless on its own.
 */
async function finalizeForSend(ctx: AuthContext, id: string): Promise<string> {
  const { invoice: draftInvoice } = await load(ctx, id)
  const { data, error } = await ctx.supabase.rpc('issue_invoice', {
    p_invoice_id: draftInvoice.id,
    p_meta: actorMeta(ctx),
  })

  if (error) throw fromPostgres(error)
  if (!data) throw upstreamFailed('Could not assign an invoice number.')

  return data
}

export async function pay(
  ctx: AuthContext,
  id: string,
  options: { paidOn?: string; reference?: string } = {},
): Promise<InvoiceRow> {
  requireScope(ctx, 'payments:write')

  const { invoice: openInvoice } = await load(ctx, id)

  const { data, error } = await ctx.supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: options.paidOn ?? new Date().toISOString() })
    .eq('id', openInvoice.id)
    // Not `.neq('draft')`. That let a void invoice be flipped to paid.
    .eq('status', 'open')
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)

  // Nothing changed. Work out why, so the caller gets a 404 or a 409 rather
  // than a success that did nothing.
  if (!data) {
    const { invoice } = await load(ctx, openInvoice.id)
    throw invalidState(`Invoice is ${invoice.status} and cannot be marked paid.`)
  }

  await writeEvent(ctx, openInvoice.id, 'paid', {
    ...actorMeta(ctx),
    ...(options.reference ? { reference: options.reference } : {}),
  })

  return data as InvoiceRow
}

/**
 * Void an open invoice.
 *
 * The number stays on the row. That is the whole point — a void invoice is
 * still part of the series, and an auditor seeing 0041, 0043 wants to find 0042
 * marked void with a reason, not missing.
 */
export async function voidInvoice(ctx: AuthContext, id: string, options: { reason: string }): Promise<InvoiceRow> {
  requireScope(ctx, 'invoices:finalize')

  const reason = options.reason?.trim()
  if (!reason) {
    throw new ServiceError('validation', 'A void reason is required.', [
      { path: 'reason', message: 'Say why this invoice is void.' },
    ])
  }

  const { invoice: openInvoice } = await load(ctx, id)

  const { data, error } = await ctx.supabase
    .from('invoices')
    .update({ status: 'void', cancelled_at: new Date().toISOString(), cancel_reason: reason })
    .eq('id', openInvoice.id)
    .eq('status', 'open')
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)

  if (!data) {
    const { invoice } = await load(ctx, openInvoice.id)
    throw invalidState(
      invoice.status === 'paid'
        ? 'A paid invoice needs a credit note, not a void.'
        : `Invoice is ${invoice.status} and cannot be voided.`,
    )
  }

  await writeEvent(ctx, openInvoice.id, 'voided', { ...actorMeta(ctx), reason })

  return data as InvoiceRow
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function load(ctx: AuthContext, id: string): Promise<InvoiceWithItems> {
  const q = ctx.supabase.from('invoices').select('*')
  const { data: invoice, error } = isInvoiceId(id)
    ? await q.eq('public_id', id).maybeSingle()
    : await q.eq('id', id).maybeSingle()

  if (error) throw fromPostgres(error)
  if (!invoice) throw notFound('Invoice not found.')

  const row = invoice as InvoiceRow

  const { data: items, error: itemsError } = await ctx.supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', row.id)
    .order('position', { ascending: true })

  if (itemsError) throw fromPostgres(itemsError)

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

  // The business default wins when the caller didn't name a currency —
  // per-invoice override otherwise, exactly like Stripe's account default.
  const currency = data.currency ?? business.currency ?? 'USD'

  // Check state up front rather than relying on a filter in the UPDATE. The
  // line items are replaced by a separate call, so a filter on the header alone
  // would let a finalized invoice's items change while its totals stayed frozen.
  let existingClientId: string | null = null
  let invoiceId: string | undefined

  if (id) {
    const { invoice } = await load(ctx, id)
    if (invoice.status !== 'draft') {
      throw invalidState('This invoice has been finalized and can no longer be edited.')
    }
    existingClientId = invoice.client_id
    invoiceId = invoice.id
  }

  // Priced lines borrow description/rate/tax from the catalog; ad-hoc lines
  // stand alone. Either way every total below is recomputed from the result.
  const resolved = await resolveLines(ctx, data.items, currency)

  const lines: TaxLineInput[] = resolved.map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    rate: line.rate,
    discountPercent: line.discountPercent,
    taxRate: line.taxRate,
  }))

  const computed = computeInvoice({ lines }, currency)

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
      .insert({ ...clientValues, public_id: nextCustomerId() })
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
    currency,
    collection_method: data.collection_method,
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
      .insert({ ...invoiceValues, public_id: nextInvoiceId() })
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
      product_id: resolved[index]?.productId ?? null,
      price_id: resolved[index]?.priceId ?? null,
      public_id: nextInvoiceItemId(),
    })),
  })

  if (itemsError) throw fromPostgres(itemsError)

  await writeEvent(ctx, invoiceId!, id ? 'updated' : 'created', actorMeta(ctx))

  return load(ctx, invoiceId!)
}

/**
 * Append one line to a draft — the `POST /v1/invoice-items` behind it.
 *
 * Implemented as a re-save through `updateDraft`, so totals, validation and
 * the draft-only guard behave exactly like a full update. Catalog links on the
 * existing lines are carried over by price reference, not by value.
 */
export async function addItem(
  ctx: AuthContext,
  id: string,
  line: InvoiceInput['items'][number],
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  const { invoice, items } = await load(ctx, id)
  if (invoice.status !== 'draft') {
    throw invalidState('This invoice has been finalized and can no longer be edited.')
  }
  const input = await draftInputFor(ctx, invoice, items)
  return writeDraft(ctx, { ...input, items: [...input.items, line] }, invoice.id)
}

/**
 * Find one line (`ii_…` or UUID) across the owner's invoices.
 *
 * RLS on `invoice_items` is enforced through the parent invoice, so a stranger's
 * id returns null rather than someone else's line.
 */
export async function findItem(
  ctx: AuthContext,
  id: string,
): Promise<{ invoice: InvoiceRow; item: InvoiceItemRow } | null> {
  requireScope(ctx, 'invoices:read')

  const q = ctx.supabase.from('invoice_items').select('*')
  const { data, error } = isInvoiceItemId(id)
    ? await q.eq('public_id', id).maybeSingle()
    : await q.eq('id', id).maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) return null

  const item = data as InvoiceItemRow
  const { invoice } = await load(ctx, item.invoice_id)
  return { invoice, item }
}

/**
 * Remove one line (`ii_…` or UUID) from a draft.
 *
 * `invoiceRef` scopes the search when given; otherwise every invoice is
 * scanned. Either way the invoice must be a draft.
 */
export async function removeItem(
  ctx: AuthContext,
  invoiceRef: string | null,
  itemId: string,
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')

  let invoice: InvoiceRow
  let items: InvoiceItemRow[]
  if (invoiceRef) {
    ;({ invoice, items } = await load(ctx, invoiceRef))
    const target = items.find((item) =>
      isInvoiceItemId(itemId) ? item.public_id === itemId : item.id === itemId,
    )
    if (!target) throw notFound('Invoice item not found.')
  } else {
    const found = await findItem(ctx, itemId)
    if (!found) throw notFound('Invoice item not found.')
    ;({ invoice, items } = await load(ctx, found.invoice.id))
  }

  if (invoice.status !== 'draft') {
    throw invalidState('This invoice has been finalized and can no longer be edited.')
  }

  const kept = items.filter((item) =>
    isInvoiceItemId(itemId) ? item.public_id !== itemId : item.id !== itemId,
  )
  if (kept.length === 0) {
    throw invalidState('An invoice needs at least one line item.')
  }

  const input = await draftInputFor(ctx, invoice, kept)
  return writeDraft(ctx, input, invoice.id)
}

/**
 * Rebuild a full draft input from stored rows, keeping catalog links as price
 * references so a re-save doesn't silently unlink priced lines.
 *
 * Exported for the PATCH route, which merges a partial wire payload over this.
 */
export async function readDraftInput(ctx: AuthContext, id: string): Promise<InvoiceInput> {
  requireScope(ctx, 'invoices:write')
  const { invoice, items } = await load(ctx, id)
  if (invoice.status !== 'draft') {
    throw invalidState('This invoice has been finalized and can no longer be edited.')
  }
  return draftInputFor(ctx, invoice, items)
}

/**
 * Rebuild a full draft input from stored rows, keeping catalog links as price
 * references so a re-save doesn't silently unlink priced lines.
 */
async function draftInputFor(
  ctx: AuthContext,
  invoice: InvoiceRow,
  items: InvoiceItemRow[],
): Promise<InvoiceInput> {
  let client: InvoiceInput['client'] = emptyClientInput()
  if (invoice.client_id) {
    const { data } = await ctx.supabase
      .from('clients')
      .select('*')
      .eq('id', invoice.client_id)
      .maybeSingle()
    const row = data as ClientRow | null
    if (row) client = clientRowToInput(row)
  }

  const priceIds = [...new Set(items.map((i) => i.price_id).filter((v): v is string => Boolean(v)))]
  const priceRefById = new Map<string, string>()
  if (priceIds.length > 0) {
    const { data } = await ctx.supabase.from('prices').select('id, public_id').in('id', priceIds)
    for (const row of (data ?? []) as Array<{ id: string; public_id: string }>) {
      priceRefById.set(row.id, row.public_id)
    }
  }

  return {
    client,
    issue_date: invoice.issue_date,
    due_date: invoice.due_date ?? '',
    currency: invoice.currency,
    collection_method:
      invoice.collection_method === 'charge_automatically' ? 'charge_automatically' : 'send_invoice',
    notes: invoice.notes ?? undefined,
    terms: invoice.terms ?? undefined,
    items: items.map((item) => {
      const ref = item.price_id ? priceRefById.get(item.price_id) : undefined
      if (ref) {
        return {
          description: '',
          quantity: Number(item.quantity),
          unit: item.unit as InvoiceInput['items'][number]['unit'],
          discount_percent: Number(item.discount_percent),
          price: ref,
        }
      }
      return {
        description: item.description,
        quantity: Number(item.quantity),
        unit: item.unit as InvoiceInput['items'][number]['unit'],
        rate: Number(item.rate),
        discount_percent: Number(item.discount_percent),
        tax_rate: Number(item.tax_rate ?? 0),
      }
    }),
  }
}

/**
 * Convert a Stripe-shaped wire payload into a full draft input.
 *
 * With `base` (the current draft) this is a PATCH merge; without it, a
 * create. Customer references resolve to full client snapshots, `description`
 * becomes notes, `footer` becomes terms, and `unit_amount` minor units become
 * major-unit rates.
 */
export async function wireToDraftInput(
  ctx: AuthContext,
  wire: InvoiceWireInput,
  base?: InvoiceInput,
): Promise<InvoiceInput> {
  const client = wire.customer
    ? clientRowToInput(await getClient(ctx, wire.customer))
    : (base?.client ?? emptyClientInput())

  const issueDate = base?.issue_date ?? new Date().toISOString().slice(0, 10)

  let dueDate = wire.due_date ?? base?.due_date ?? ''
  if (!wire.due_date && wire.days_until_due !== undefined && !base) {
    const due = new Date(`${issueDate}T00:00:00`)
    due.setDate(due.getDate() + wire.days_until_due)
    dueDate = due.toISOString().slice(0, 10)
  }

  return {
    client,
    issue_date: issueDate,
    due_date: dueDate,
    currency: wire.currency ?? base?.currency,
    collection_method: wire.collection_method ?? base?.collection_method ?? 'send_invoice',
    notes: wire.description ?? base?.notes,
    terms: wire.footer ?? base?.terms,
    items:
      wire.items?.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.unit_amount !== undefined ? item.unit_amount / 100 : undefined,
        discount_percent: item.discount_percent,
        tax_rate: item.tax_rate,
        price: item.price,
      })) ??
      base?.items ??
      [],
  }
}

async function resolveLines(
  ctx: AuthContext,
  items: InvoiceInput['items'],
  currency: string,
): Promise<ResolvedLine[]> {
  const refs = [...new Set(items.map((item) => item.price).filter((ref): ref is string => Boolean(ref)))]

  const byRef = new Map<string, CatalogPrice>()
  if (refs.length > 0) {
    const prices = await getManyWithProducts(ctx, refs)
    for (const price of prices) {
      const entry: CatalogPrice = {
        id: price.id,
        public_id: price.public_id,
        product_id: price.product_id,
        product_name: price.product_name,
        unit_amount: Number(price.unit_amount),
        currency: price.currency,
        tax_rate: Number(price.tax_rate),
      }
      byRef.set(price.id, entry)
      byRef.set(price.public_id, entry)
    }
  }

  return resolvePricedLines(items, currency, byRef)
}

/**
 * Who did this.
 *
 * Stamped onto every event so "an AI assistant voided this invoice" has an
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
