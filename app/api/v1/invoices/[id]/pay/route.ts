import { json, readJson, withApi } from '@/lib/api/handler'
import { payInvoice } from '@/lib/operations/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/pay  { paid_on?, reference?, amount? }
 *
 * Records a payment received outside Invoice-AI against an open invoice. No
 * amount pays the whole balance; a smaller one is a partial payment. The
 * ledger function locks the invoice row, so this can't double-count with an
 * online payment arriving at the same moment.
 */
export const POST = withApi<Params>(
  { scope: 'payments:write', idempotent: 'required' },
  async (ctx, request, route) => {
    const { id } = await route.params
    const body = (await readJson(request)) as { paid_on?: string; reference?: string; amount?: number }

    return json(await payInvoice(ctx, id, { paid_on: body?.paid_on, reference: body?.reference, amount: body?.amount }))
  },
)
