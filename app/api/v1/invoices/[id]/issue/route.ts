import { json, withApi } from '@/lib/api/handler'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/issue
 *
 * Assigns a permanent GST invoice number. This is the single most important
 * endpoint to get idempotency right on, and it is defended twice:
 *
 *   1. Idempotency-Key (required, 428 without one) replays the stored response
 *      for a retry, so the handler never runs a second time.
 *   2. issue_invoice() takes a row lock and returns the EXISTING number if the
 *      invoice already has one — so even a caller that bypasses the key layer
 *      entirely cannot burn a second number.
 *
 * Belt and braces, because the cost of getting it wrong is a permanent gap in a
 * series that GST law requires to be consecutive.
 */
export const POST = withApi<Params>(
  { scope: 'invoices:issue', idempotent: 'required' },
  async (ctx, _request, route) => {
    const { id } = await route.params
    const { invoiceNumber } = await invoices.issue(ctx, id)

    return json({ data: { id, invoice_number: invoiceNumber, status: 'sent' } })
  },
)
