import { serializeEvent, serializeInvoice } from '@/lib/api/serialize'
import { parseWire } from '@/lib/api/validate'
import type { AuthContext } from '@/lib/auth/context'
import type { InvoiceStatus } from '@/lib/database.types'
import { get as getClient } from '@/lib/services/clients'
import * as invoices from '@/lib/services/invoices'
import { invoiceCreateWireSchema, invoiceWireSchema } from '@/lib/validators'

/**
 * Invoice operations, shared by every door into the product.
 *
 * A REST route (app/api/v1/invoices/**) and an MCP tool (lib/mcp/tools) are two
 * ways of asking for the same thing. Each operation here is that thing: it
 * takes plain, typed input, calls the services (which enforce scopes and RLS),
 * and returns exactly the JSON body the REST API documents. So "what does
 * finalize return?" has one answer, whichever door you came in by.
 *
 * Operations know nothing about HTTP or MCP: no Request, no Response, no
 * status codes. The pipeline (lib/api/pipeline.ts) wraps them with rate
 * limits, idempotency and audit; each door turns the result into its reply.
 */

const STATUSES: InvoiceStatus[] = ['draft', 'open', 'paid', 'overdue', 'void']

export interface ListInvoicesInput {
  /** draft | open | paid | overdue | void. `overdue` = open and past due (UTC). */
  status?: string | null
  /** A `cus_…` id or UUID. */
  customer?: string | null
  from?: string | null
  to?: string | null
  cursor?: string | null
  limit?: number
}

export async function listInvoices(ctx: AuthContext, input: ListInvoicesInput) {
  const clientId = input.customer ? (await getClient(ctx, input.customer)).id : undefined

  const page = await invoices.list(ctx, {
    status: input.status && STATUSES.includes(input.status as InvoiceStatus) ? (input.status as InvoiceStatus) : undefined,
    clientId,
    from: input.from ?? undefined,
    to: input.to ?? undefined,
    cursor: input.cursor ?? null,
    limit: input.limit,
  })

  const customers = await invoices.customerMap(
    ctx,
    page.data.map((row) => row.client_id),
  )

  return {
    data: page.data.map((row) =>
      serializeInvoice(row, undefined, { customerPublicId: customers.get(row.client_id ?? '') ?? null }),
    ),
    next_cursor: page.next_cursor,
  }
}

/** One invoice with its lines. `in_…` or UUID. */
export async function retrieveInvoice(ctx: AuthContext, id: string) {
  return { data: await serializedInvoice(ctx, id) }
}

/**
 * Create a draft from the documented request body.
 *
 * `raw` is validated here, not by the caller, so REST and MCP reject exactly
 * the same inputs with exactly the same messages.
 */
export async function createInvoice(ctx: AuthContext, raw: unknown) {
  const wire = parseWire(invoiceCreateWireSchema, raw)
  // `customer` links the saved row; without it the draft would get a copy.
  const { invoice, items } = await invoices.createDraft(ctx, await invoices.wireToDraftInput(ctx, wire), {
    customer: wire.customer,
  })
  const refs = await invoices.refsForInvoice(ctx, invoice, items)

  return { data: serializeInvoice(invoice, items, refs) }
}

/**
 * Partial update of a draft: omitted fields keep their stored values, and the
 * lines are only replaced when `items` is sent.
 */
export async function updateInvoice(ctx: AuthContext, id: string, raw: unknown) {
  const wire = parseWire(invoiceWireSchema, raw)
  const base = await invoices.readDraftInput(ctx, id)
  const { invoice, items } = await invoices.updateDraft(
    ctx,
    id,
    await invoices.wireToDraftInput(ctx, wire, base.input),
    // Link (never overwrite) the saved customer: the one sent, or the current one.
    { customer: wire.customer ?? base.customer ?? undefined },
  )
  const refs = await invoices.refsForInvoice(ctx, invoice, items)

  return { data: serializeInvoice(invoice, items, refs) }
}

/** Drafts only. A finalized invoice is voided, never deleted. */
export async function deleteInvoice(ctx: AuthContext, id: string): Promise<void> {
  await invoices.deleteDraft(ctx, id)
}

/** Assign the next number and open the invoice. Safe to repeat. */
export async function finalizeInvoice(ctx: AuthContext, id: string) {
  await invoices.finalize(ctx, id)
  return { data: await serializedInvoice(ctx, id) }
}

/** Finalize if needed, then email the PDF. */
export async function sendInvoice(ctx: AuthContext, id: string, input: { to?: string | null }) {
  const result = await invoices.send(ctx, id, { to: input.to ?? undefined })
  return { data: await serializedInvoice(ctx, id), emailed_to: result.emailedTo }
}

export async function payInvoice(
  ctx: AuthContext,
  id: string,
  input: { paid_on?: string | null; reference?: string | null; amount?: number | null },
) {
  const invoice = await invoices.pay(ctx, id, {
    paidOn: input.paid_on ?? undefined,
    reference: input.reference ?? undefined,
    amountMinor: input.amount ?? undefined,
  })
  const refs = await invoices.refsForInvoice(ctx, invoice, [])

  return { data: serializeInvoice(invoice, undefined, refs) }
}

export async function voidInvoice(ctx: AuthContext, id: string, input: { reason?: string | null }) {
  const invoice = await invoices.voidInvoice(ctx, id, { reason: input.reason ?? '' })
  const refs = await invoices.refsForInvoice(ctx, invoice, [])

  return { data: serializeInvoice(invoice, undefined, refs) }
}

export async function listInvoiceEvents(
  ctx: AuthContext,
  id: string,
  input: { cursor?: string | null; limit?: number },
) {
  const page = await invoices.events(ctx, id, { cursor: input.cursor ?? null, limit: input.limit })
  return { data: page.data.map(serializeEvent), next_cursor: page.next_cursor }
}

async function serializedInvoice(ctx: AuthContext, id: string) {
  const { invoice, items } = await invoices.get(ctx, id)
  const refs = await invoices.refsForInvoice(ctx, invoice, items)
  return serializeInvoice(invoice, items, refs)
}
