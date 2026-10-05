import { json, noContent, readJson, withApi } from '@/lib/api/handler'
import { deleteInvoice, retrieveInvoice, updateInvoice } from '@/lib/operations/invoices'

type Params = { id: string }

/** GET /api/v1/invoices/{id} — `in_…` or UUID, includes lines. */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json(await retrieveInvoice(ctx, id))
})

/**
 * PATCH /api/v1/invoices/{id} — drafts only.
 *
 * Partial: any subset of the create fields, `customer` included. Omitted
 * fields keep their stored values and the lines are only replaced when
 * `items` is sent. Once finalized, the document is frozen — the customer may
 * already have the PDF — and the service returns 409 invalid_state rather
 * than silently ignoring the write.
 */
export const PATCH = withApi<Params>({ scope: 'invoices:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  return json(await updateInvoice(ctx, id, await readJson(request)))
})

/**
 * DELETE /api/v1/invoices/{id} — drafts only.
 *
 * A finalized invoice can never be deleted. Its number belongs to a
 * consecutive series, and a gap is what an audit reads as a hidden sale.
 * Use POST /void instead, which keeps the number on the record.
 */
export const DELETE = withApi<Params>({ scope: 'invoices:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  await deleteInvoice(ctx, id)

  return noContent()
})
