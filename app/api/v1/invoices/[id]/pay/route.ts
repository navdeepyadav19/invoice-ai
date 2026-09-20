import { json, readJson, withApi } from '@/lib/api/handler'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/pay  { paid_on?, reference? }
 *
 * Only an open invoice can be marked paid — not a draft, not a void one.
 * The service checks the row actually changed before writing the `paid` event,
 * so a wrong id gives 404/409 instead of a success that fires a false
 * invoice.paid webhook.
 */
export const POST = withApi<Params>(
  { scope: 'payments:write', idempotent: 'required' },
  async (ctx, request, route) => {
    const { id } = await route.params
    const body = (await readJson(request)) as { paid_on?: string; reference?: string }

    const invoice = await invoices.pay(ctx, id, {
      paidOn: body?.paid_on,
      reference: body?.reference,
    })
    const refs = await invoices.refsForInvoice(ctx, invoice, [])

    return json({ data: serializeInvoice(invoice, undefined, refs) })
  },
)
