import { z } from 'zod'

import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeInvoice, serializeLineItem } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'
import { UNITS } from '@/lib/units'

const invoiceItemWireSchema = z.object({
  /** The draft invoice: `in_…` or UUID. */
  invoice: z.string().trim().min(1, 'Pick an invoice'),
  price: z.string().trim().optional(),
  description: z.string().trim().default(''),
  quantity: z.coerce.number().gt(0, 'Quantity must be more than zero').default(1),
  unit: z.enum(UNITS).default('NOS'),
  /** Minor units, like Stripe. Omitted on priced lines — borrowed from the price. */
  unit_amount: z.coerce.number().int('Use whole minor units').min(0).optional(),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  tax_rate: z.coerce.number().min(0).max(100).optional(),
})

/** GET /api/v1/invoice-items?invoice= — lines of one draft or open invoice. */
export const GET = withApi({ scope: 'invoices:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const invoiceRef = params.get('invoice')
  if (!invoiceRef) {
    const { ServiceError } = await import('@/lib/services/errors')
    throw new ServiceError('validation', 'Some fields need attention.', [
      { path: 'invoice', message: 'Pick an invoice' },
    ])
  }

  const { invoice, items } = await invoices.get(ctx, invoiceRef)
  const refs = await invoices.refsForInvoice(ctx, invoice, items)

  return json({ data: items.map((item) => serializeLineItem(item, invoice.currency, refs)) })
})

/**
 * POST /api/v1/invoice-items — append one line to a draft.
 *
 * Either `price` or (`description` + `unit_amount`). Totals recompute, so the
 * response is the whole invoice, like Stripe's invoice object after the call.
 */
export const POST = withApi(
  { scope: 'invoices:write', idempotent: 'required' },
  async (ctx, request) => {
    const wire = parseWire(invoiceItemWireSchema, (await readJson(request)) as unknown)
    const { invoice, items } = await invoices.addItem(
      ctx,
      wire.invoice,
      {
        description: wire.description,
        quantity: wire.quantity,
        unit: wire.unit,
        discount_percent: wire.discount_percent,
        tax_rate: wire.tax_rate,
        price: wire.price,
      },
      // Minor units of the invoice's currency; the service knows which one.
      { unitAmountMinor: wire.unit_amount },
    )
    const refs = await invoices.refsForInvoice(ctx, invoice, items)

    return json({ data: serializeInvoice(invoice, items, refs) }, { status: 201 })
  },
)
