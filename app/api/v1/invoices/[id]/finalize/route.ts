import { json, withApi } from '@/lib/api/handler'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/finalize
 *
 * Assigns a permanent invoice number and opens the invoice. This is the single
 * most important endpoint to get idempotency right on, and it is defended twice:
 *
 *   1. Idempotency-Key (required, 428 without one) replays the stored response
 *      for a retry, so the handler never runs a second time.
 *   2. issue_invoice() takes a row lock and returns the EXISTING number if the
 *      invoice already has one — so even a caller that bypasses the key layer
 *      entirely cannot burn a second number.
 *
 * Belt and braces, because the cost of getting it wrong is a permanent gap in a
 * series that must stay consecutive.
 */
export const POST = withApi<Params>(
  { scope: 'invoices:finalize', idempotent: 'required' },
  async (ctx, _request, route) => {
    const { id } = await route.params
    await invoices.finalize(ctx, id)
    const { invoice, items } = await invoices.get(ctx, id)
    const refs = await invoices.refsForInvoice(ctx, invoice, items)

    return json({ data: serializeInvoice(invoice, items, refs) })
  },
)
