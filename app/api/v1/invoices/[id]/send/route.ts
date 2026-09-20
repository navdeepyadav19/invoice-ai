import { json, readJson, withApi } from '@/lib/api/handler'
import { DEFAULT_RULES } from '@/lib/api/rate-limit'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * POST /api/v1/invoices/{id}/send  { to? }
 *
 * Issues the invoice first if it has no number yet, then emails the PDF.
 *
 * Rate-limited far harder than everything else (10/hour, not 120/minute):
 * each call costs money, lands in a third party's inbox, and is the first thing
 * a stolen key would be used to abuse. A tight cap here is a blast-radius
 * control, not a performance one.
 */
export const POST = withApi<Params>(
  {
    scope: 'invoices:send',
    idempotent: 'required',
    rateLimit: DEFAULT_RULES.send,
    rateLimitBucket: 'send',
  },
  async (ctx, request, route) => {
    const { id } = await route.params
    const body = (await readJson(request)) as { to?: string }

    const result = await invoices.send(ctx, id, { to: body?.to })

    return json({
      data: {
        id,
        invoice_number: result.invoiceNumber,
        emailed: result.emailed,
        public_url: result.publicUrl,
      },
    })
  },
)
