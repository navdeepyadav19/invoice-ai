import { json, noContent, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'
import type { AuthContext } from '@/lib/auth/context'
import { invoiceWireSchema } from '@/lib/validators'

type Params = { id: string }

async function serialized(ctx: AuthContext, id: string) {
  const { invoice, items } = await invoices.get(ctx, id)
  const refs = await invoices.refsForInvoice(ctx, invoice, items)
  return serializeInvoice(invoice, items, refs)
}

/** GET /api/v1/invoices/{id} — `in_…` or UUID, includes lines. */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: await serialized(ctx, id) })
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
  const wire = parseWire(invoiceWireSchema, (await readJson(request)) as unknown)
  const base = await invoices.readDraftInput(ctx, id)
  const { invoice, items } = await invoices.updateDraft(
    ctx,
    id,
    await invoices.wireToDraftInput(ctx, wire, base.input),
    // Link (never overwrite) the saved customer: the one sent, or the current one.
    { customer: wire.customer ?? base.customer ?? undefined },
  )
  const refs = await invoices.refsForInvoice(ctx, invoice, items)

  return json({ data: serializeInvoice(invoice, items, refs) })
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
  await invoices.deleteDraft(ctx, id)

  return noContent()
})
