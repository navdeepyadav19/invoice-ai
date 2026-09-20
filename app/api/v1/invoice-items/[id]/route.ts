import { json, withApi } from '@/lib/api/handler'
import { serializeInvoice, serializeLineItem } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/** GET /api/v1/invoice-items/{id} — `ii_…` or UUID. Scans the owner's invoices. */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  const found = await invoices.findItem(ctx, id)
  if (!found) {
    const { notFound } = await import('@/lib/services/errors')
    throw notFound('Invoice item not found.')
  }
  const refs = await invoices.refsForInvoice(ctx, found.invoice, [found.item])

  return json({ data: serializeLineItem(found.item, refs) })
})

/**
 * DELETE /api/v1/invoice-items/{id} — remove one line from a draft.
 * `invoice` query param scopes the search; without it every invoice is scanned.
 */
export const DELETE = withApi<Params>({ scope: 'invoices:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const invoiceRef = new URL(request.url).searchParams.get('invoice')
  const { invoice, items } = await invoices.removeItem(ctx, invoiceRef ?? null, id)
  const refs = await invoices.refsForInvoice(ctx, invoice, items)

  return json({ data: serializeInvoice(invoice, items, refs) })
})
