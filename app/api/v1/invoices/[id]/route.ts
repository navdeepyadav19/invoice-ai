import { json, noContent, readJson, withApi } from '@/lib/api/handler'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'
import type { InvoiceInput } from '@/lib/validators'

type Params = { id: string }

/** GET /api/v1/invoices/{id} — includes line items. */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  const { invoice, items } = await invoices.get(ctx, id)

  return json({ data: serializeInvoice(invoice, items) })
})

/**
 * PATCH /api/v1/invoices/{id} — drafts only.
 *
 * Once issued, the document is frozen: a client has a PDF with an invoice number on
 * it, and the record has to keep matching what they received. The service
 * returns 409 invalid_state rather than silently ignoring the write.
 */
export const PATCH = withApi<Params>({ scope: 'invoices:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const body = (await readJson(request)) as InvoiceInput
  const { invoice, items } = await invoices.updateDraft(ctx, id, body)

  return json({ data: serializeInvoice(invoice, items) })
})

/**
 * DELETE /api/v1/invoices/{id} — drafts only.
 *
 * An issued invoice can never be deleted. Its number belongs to a consecutive series
 * requires to be consecutive, and a gap is what an audit reads as a hidden
 * sale. Use POST /cancel instead, which keeps the number on the record.
 */
export const DELETE = withApi<Params>({ scope: 'invoices:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  await invoices.deleteDraft(ctx, id)

  return noContent()
})
