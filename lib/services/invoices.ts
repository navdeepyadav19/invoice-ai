import { requireScope, type AuthContext } from '@/lib/auth/context'
import type { Db } from '@/lib/db'
import { issueInvoice, replaceInvoiceItems } from '@/lib/db/rpc'
import { invalidState, notFound, q, rateLimitedError, ServiceError, upstreamFailed } from '@/lib/services/errors'
import { afterPosition, clampLimit, parseCursor, toPage, type Page } from '@/lib/services/pagination'
import * as businesses from '@/lib/services/business'
import { get as getClient, rowToInput as clientRowToInput } from '@/lib/services/clients'
import { invoiceSchema, emptyClientInput, type InvoiceInput, type InvoiceWireInput } from '@/lib/validators'
import { computeInvoice, type TaxLineInput } from '@/lib/tax'
import { paiseToStored, wireMinorToMajor } from '@/lib/money-api'
import { getManyWithProducts } from '@/lib/services/prices'
import { isInvoiceId, isInvoiceItemId, isUuid, nextCustomerId, nextInvoiceId, nextInvoiceItemId } from '@/lib/catalog/ids'
import { resolvePricedLines, type CatalogPrice, type ResolvedLine } from '@/lib/catalog/resolve'
import { snapshotBusiness } from '@/lib/invoice-view'
import { viewFromRows } from '@/lib/invoice-load'
import { deriveStatus, todayUtc } from '@/lib/invoice-status'
import { renderInvoicePdf, pdfFilename } from '@/lib/pdf'
import { sendInvoiceEmail } from '@/lib/email'
import { checkRateLimit } from '@/lib/api/rate-limit'
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

  let query = ctx.db
    .selectFrom('invoices')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)

  // `overdue` is never stored, but it is still a WHERE clause: open and due
  // before today (UTC — the same day deriveStatus uses). Filtering in SQL, not
  // after the fetch, is what keeps every page full and `next_cursor` honest;
  // narrowing afterwards returned short pages and could stop early.
  if (options.status === 'overdue') {
    query = query.where('status', '=', 'open').where('due_date', '<', todayUtc())
  } else if (options.status) {
    query = query.where('status', '=', options.status)
  }

  if (options.clientId) query = query.where('client_id', '=', options.clientId)
  if (options.from) query = query.where('issue_date', '>=', options.from)
  if (options.to) query = query.where('issue_date', '<=', options.to)

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())

  return toPage(data as InvoiceRow[], limit)
}

export async function get(ctx: AuthContext, id: string): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:read')
  return load(ctx, id)
}

export async function events(
  ctx: AuthContext,
  id: string,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<Page<InvoiceEventRow>> {
  requireScope(ctx, 'invoices:read')

  // Confirms the invoice is ours before returning its history. Without this,
  // an unknown id would return an empty array rather than a 404.
  const { invoice: eventInvoice } = await load(ctx, id)
  const limit = clampLimit(options.limit)

  let query = ctx.db
    .selectFrom('invoice_events')
    .selectAll()
    .where('invoice_id', '=', eventInvoice.id)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())
  return toPage(data as InvoiceEventRow[], limit)
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

/**
 * How a draft save treats its Bill-to row.
 *
 *   customer: 'cus_…' | uuid   Bill a saved customer. The draft points at that
 *                              row and the row is NOT modified — the invoice's
 *                              client_snapshot records what was billed.
 *   customer: null             The draft used to point at a saved customer and
 *                              the user detached (edited the fields or clicked
 *                              "change"). Give the draft a fresh row of its own
 *                              so the saved customer is never overwritten.
 *   customer omitted           Existing behaviour: reuse and update the row
 *                              this draft already owns, or create one.
 */
export interface DraftClientOptions {
  customer?: string | null
}

export async function createDraft(
  ctx: AuthContext,
  input: InvoiceInput,
  options: DraftClientOptions = {},
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  return writeDraft(ctx, input, undefined, options)
}

export async function updateDraft(
  ctx: AuthContext,
  id: string,
  input: InvoiceInput,
  options: DraftClientOptions = {},
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  return writeDraft(ctx, input, id, options)
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
    const data = await q(
      ctx.db.selectFrom('prices').select(['id', 'public_id']).where('id', 'in', priceIds).execute(),
    )
    for (const row of data) pricePublicById.set(row.id, row.public_id)
  }

  const productPublicById = new Map<string, string>()
  if (productIds.length > 0) {
    const data = await q(
      ctx.db.selectFrom('products').select(['id', 'public_id']).where('id', 'in', productIds).execute(),
    )
    for (const row of data) productPublicById.set(row.id, row.public_id)
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

  const data = await q(
    ctx.db.selectFrom('clients').select(['id', 'public_id']).where('id', 'in', unique).execute(),
  )
  for (const row of data) map.set(row.id, row.public_id)
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

  await q(
    ctx.db.deleteFrom('invoices').where('id', '=', invoice.id).where('status', '=', 'draft').execute(),
  )
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Assign an invoice number.
 *
 * All the real work is in the `issue_invoice` SQL function, which takes a row lock so two
 * concurrent calls cannot both claim a number. Calling it twice returns the same
 * number rather than erroring, which is what makes a retry safe even if the
 * Idempotency-Key layer above is bypassed entirely.
 */
export async function finalize(ctx: AuthContext, id: string): Promise<{ invoiceNumber: string }> {
  requireScope(ctx, 'invoices:finalize')

  // Surfaces a 404 for an unknown id before issue_invoice() turns it into P0002.
  const { invoice: draftInvoice } = await load(ctx, id)

  const data = await q(issueInvoice(ctx.db, draftInvoice.id, actorMeta(ctx)))
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
): Promise<{ emailed: boolean; emailedTo: string; publicUrl: string; invoiceNumber: string }> {
  requireScope(ctx, 'invoices:send')

  // The recipient arrives straight from API JSON. Anything but a plausible
  // address is refused here, before a number is spent or a PDF rendered.
  if (options.to != null && options.to !== '' && (typeof options.to !== 'string' || !EMAIL.test(options.to))) {
    throw new ServiceError('validation', 'to must be an email address.', [
      { path: 'to', message: 'Expected a single email address.' },
    ])
  }

  // Sign-up is open and Neon Auth's own verification is off, so an unverified
  // account is just a typed-in address. Letting it email strangers from our
  // domain is a spam and phishing relay. Checked before the rate limit and
  // before finalizing, so a refused send spends neither a slot nor a number.
  const profile = await q(
    ctx.db.selectFrom('profiles').select('email_verified_at').where('id', '=', ctx.userId).executeTakeFirst(),
  )
  if (!profile?.email_verified_at) {
    throw invalidState(
      'Verify your email address before emailing invoices: use the link we sent you, or resend it from the dashboard.',
    )
  }

  // Every send lands in a stranger's inbox from our domain, so it is capped per
  // owner whichever way it arrives — the API's per-key bucket alone leaves the
  // dashboard (and a stack of keys) unlimited.
  const limit = await checkRateLimit(ctx.userId, 'send-owner', SENDS_PER_OWNER)
  if (!limit.ok) {
    throw rateLimitedError(
      `Too many invoices emailed in the last hour. Try again in ${Math.ceil(limit.retryAfter / 60)} min.`,
      limit.retryAfter,
    )
  }

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

  return { emailed: true, emailedTo: recipient, publicUrl, invoiceNumber }
}

/** Deliberately loose: Resend does the real validation; this keeps out junk. */
const EMAIL = /^[^\s@,;<>]{1,64}@[^\s@,;<>]{1,189}\.[^\s@,;<>]{2,63}$/

/** Shared by every credential an owner holds, dashboard included. */
const SENDS_PER_OWNER = { limit: 50, windowSeconds: 3600 }

/**
 * `invoices:send` implies issuing, because you cannot email an unnumbered
 * invoice. The scope check is skipped here on purpose — requiring both
 * `invoices:finalize` and `invoices:send` to send one email would make the
 * narrower-looking scope useless on its own.
 */
async function finalizeForSend(ctx: AuthContext, id: string): Promise<string> {
  const { invoice: draftInvoice } = await load(ctx, id)
  const data = await q(issueInvoice(ctx.db, draftInvoice.id, actorMeta(ctx)))
  if (!data) throw upstreamFailed('Could not assign an invoice number.')

  return data
}

export async function pay(
  ctx: AuthContext,
  id: string,
  options: { paidOn?: string; reference?: string } = {},
): Promise<InvoiceRow> {
  requireScope(ctx, 'payments:write')

  if (options.paidOn != null && (typeof options.paidOn !== 'string' || Number.isNaN(Date.parse(options.paidOn)))) {
    throw new ServiceError('validation', 'paid_on must be an ISO 8601 date.', [
      { path: 'paid_on', message: 'Expected a date like 2026-10-04.' },
    ])
  }
  if (options.reference != null && (typeof options.reference !== 'string' || options.reference.length > 200)) {
    throw new ServiceError('validation', 'reference must be a string of at most 200 characters.', [
      { path: 'reference', message: 'At most 200 characters.' },
    ])
  }

  const { invoice: openInvoice } = await load(ctx, id)

  const data = await q(
    ctx.db
      .updateTable('invoices')
      .set({ status: 'paid', paid_at: options.paidOn ?? new Date().toISOString() })
      .where('id', '=', openInvoice.id)
      // Not `status <> 'draft'`. That let a void invoice be flipped to paid.
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst(),
  )

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

  return data as unknown as InvoiceRow
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

  const reason = typeof options.reason === 'string' ? options.reason.trim() : ''
  if (reason.length > 500) {
    throw new ServiceError('validation', 'The void reason must be at most 500 characters.', [
      { path: 'reason', message: 'At most 500 characters.' },
    ])
  }
  if (!reason) {
    throw new ServiceError('validation', 'A void reason is required.', [
      { path: 'reason', message: 'Say why this invoice is void.' },
    ])
  }

  const { invoice: openInvoice } = await load(ctx, id)

  const data = await q(
    ctx.db
      .updateTable('invoices')
      .set({ status: 'void', cancelled_at: new Date().toISOString(), cancel_reason: reason })
      .where('id', '=', openInvoice.id)
      .where('status', '=', 'open')
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) {
    const { invoice } = await load(ctx, openInvoice.id)
    throw invalidState(
      invoice.status === 'paid'
        ? 'A paid invoice needs a credit note, not a void.'
        : `Invoice is ${invoice.status} and cannot be voided.`,
    )
  }

  await writeEvent(ctx, openInvoice.id, 'voided', { ...actorMeta(ctx), reason })

  return data as unknown as InvoiceRow
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function load(ctx: AuthContext, id: string): Promise<InvoiceWithItems> {
  if (!isInvoiceId(id) && !isUuid(id)) throw notFound('Invoice not found.')

  const invoice = await q(
    ctx.db
      .selectFrom('invoices')
      .selectAll()
      .where(isInvoiceId(id) ? 'public_id' : 'id', '=', id)
      .executeTakeFirst(),
  )
  if (!invoice) throw notFound('Invoice not found.')

  const row = invoice as unknown as InvoiceRow

  const items = await q(
    ctx.db
      .selectFrom('invoice_items')
      .selectAll()
      .where('invoice_id', '=', row.id)
      .orderBy('position', 'asc')
      .execute(),
  )

  return {
    invoice: row,
    items: items as InvoiceItemRow[],
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
  options: DraftClientOptions = {},
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

  // A saved customer: link, never overwrite. RLS makes someone else's id a
  // plain 404. The row is left exactly as the customer list has it. Resolved
  // before the transaction so the 404 costs no write.
  const savedClientId = options.customer ? (await getClient(ctx, options.customer)).id : null

  const invoiceValues = {
    owner_id: ctx.userId,
    business_id: business.id,
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
    // jsonb: stringified so the column gets exactly this JSON.
    business_snapshot: JSON.stringify(snapshotBusiness(business)),
    client_snapshot: JSON.stringify({ ...clientValues, owner_id: undefined }),
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

  const itemValues = computed.lines.map((line, index) => ({
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
  }))

  // Client row, invoice header and line items land together or not at all —
  // a failure part-way can no longer leave a header whose totals don't match
  // its items, or an orphaned client row.
  invoiceId = await q(
    atomically(ctx.db, async (trx) => {
      // Reuse the row this draft already points at, so editing doesn't leave a
      // trail of near-identical clients behind.
      let clientId = savedClientId ?? existingClientId

      if (!savedClientId) {
        if (clientId && options.customer !== null) {
          await trx.updateTable('clients').set(clientValues).where('id', '=', clientId).execute()
        } else {
          const created = await trx
            .insertInto('clients')
            .values({ ...clientValues, public_id: nextCustomerId() })
            .returning('id')
            .executeTakeFirstOrThrow()
          clientId = created.id
        }
      }

      let targetId = invoiceId
      if (targetId) {
        await trx
          .updateTable('invoices')
          .set({ ...invoiceValues, client_id: clientId })
          .where('id', '=', targetId)
          .where('status', '=', 'draft')
          .execute()
      } else {
        const created = await trx
          .insertInto('invoices')
          .values({ ...invoiceValues, client_id: clientId, public_id: nextInvoiceId() })
          .returning('id')
          .executeTakeFirstOrThrow()
        targetId = created.id
      }

      // replace_invoice_items swaps the whole set in one statement, so even on
      // its own either the new items land or the old ones are untouched.
      await replaceInvoiceItems(trx, targetId, itemValues)
      return targetId
    }),
  )

  await writeEvent(ctx, invoiceId, id ? 'updated' : 'created', actorMeta(ctx))

  return load(ctx, invoiceId)
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
  options: { unitAmountMinor?: number } = {},
): Promise<InvoiceWithItems> {
  requireScope(ctx, 'invoices:write')
  const { invoice, items } = await load(ctx, id)
  if (invoice.status !== 'draft') {
    throw invalidState('This invoice has been finalized and can no longer be edited.')
  }
  // A wire `unit_amount` is in the invoice currency's minor unit, which only
  // the stored invoice knows.
  const added =
    options.unitAmountMinor !== undefined
      ? { ...line, rate: wireMinorToMajor(options.unitAmountMinor, invoice.currency, 'unit_amount') }
      : line
  const input = await draftInputFor(ctx, invoice, items)
  return writeDraft(ctx, { ...input, items: [...input.items, added] }, invoice.id)
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
  if (!isInvoiceItemId(id) && !isUuid(id)) return null

  const data = await q(
    ctx.db
      .selectFrom('invoice_items')
      .selectAll()
      .where(isInvoiceItemId(id) ? 'public_id' : 'id', '=', id)
      .executeTakeFirst(),
  )
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
export async function readDraftInput(
  ctx: AuthContext,
  id: string,
): Promise<{ input: InvoiceInput; customer: string | null }> {
  requireScope(ctx, 'invoices:write')
  const { invoice, items } = await load(ctx, id)
  if (invoice.status !== 'draft') {
    throw invalidState('This invoice has been finalized and can no longer be edited.')
  }
  // `customer` is the linked row, so a PATCH that leaves it out keeps billing
  // the same customer without rewriting that customer's record.
  return { input: await draftInputFor(ctx, invoice, items), customer: invoice.client_id }
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
    const row = await q(
      ctx.db.selectFrom('clients').selectAll().where('id', '=', invoice.client_id).executeTakeFirst(),
    )
    if (row) client = clientRowToInput(row as ClientRow)
  }

  const priceIds = [...new Set(items.map((i) => i.price_id).filter((v): v is string => Boolean(v)))]
  const priceRefById = new Map<string, string>()
  if (priceIds.length > 0) {
    const data = await q(
      ctx.db.selectFrom('prices').select(['id', 'public_id']).where('id', 'in', priceIds).execute(),
    )
    for (const row of data) priceRefById.set(row.id, row.public_id)
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
 * major-unit rates in the invoice currency (the one sent, the draft's, or the
 * business default — the same order writeDraft resolves it in).
 *
 * PATCH semantics: every omitted field keeps its stored value, and the lines
 * are only replaced when `items` is sent.
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

  const currency =
    wire.currency ?? base?.currency ?? (wire.items?.some((item) => item.unit_amount !== undefined)
      ? ((await businesses.getPrimary(ctx)).currency ?? 'USD')
      : undefined)

  return {
    client,
    issue_date: issueDate,
    due_date: dueDate,
    currency: wire.currency ?? base?.currency,
    collection_method: wire.collection_method ?? base?.collection_method ?? 'send_invoice',
    notes: wire.description ?? base?.notes,
    terms: wire.footer ?? base?.terms,
    items:
      wire.items?.map((item, index) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate:
          item.unit_amount !== undefined
            ? wireMinorToMajor(item.unit_amount, currency ?? 'USD', `items.${index}.unit_amount`)
            : undefined,
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

/**
 * Run `fn` in a transaction, or inside the caller's if `db` already is one
 * (Kysely refuses to nest `transaction()`).
 */
function atomically<T>(db: Db, fn: (trx: Db) => Promise<T>): Promise<T> {
  return db.isTransaction ? fn(db) : db.transaction().execute(fn)
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
  try {
    await ctx.db
      .insertInto('invoice_events')
      .values({ invoice_id: invoiceId, type, meta: JSON.stringify(meta) })
      .execute()
  } catch (error) {
    console.error('[invoice_events] failed to record %s for %s: %s', type, invoiceId, (error as Error).message)
  }
}

