import { json, readJson, withApi } from '@/lib/api/handler'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/void  { reason }
 *
 * The invoice keeps its number. That is the point: an auditor seeing 0041 then
 * 0043 wants to find 0042 marked void with a reason, not missing.
 *
 * `invoices:finalize`, not a scope of its own — finalizing and voiding are the
 * two halves of controlling the number series, and a credential trusted with
 * one is trusted with the other.
 *
 * A paid invoice cannot be voided. That needs a credit note, which
 * is a different document with its own numbering, and is out of scope for v1.
 */
export const POST = withApi<Params>(
  { scope: 'invoices:finalize', idempotent: 'required' },
  async (ctx, request, route) => {
    const { id } = await route.params
    const body = (await readJson(request)) as { reason?: string }

    const invoice = await invoices.voidInvoice(ctx, id, { reason: body?.reason ?? '' })
    const refs = await invoices.refsForInvoice(ctx, invoice, [])

    return json({ data: serializeInvoice(invoice, undefined, refs) })
  },
)
