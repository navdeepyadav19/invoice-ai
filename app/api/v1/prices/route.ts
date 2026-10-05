import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializePrice } from '@/lib/api/serialize'
import * as prices from '@/lib/services/prices'
import { mapPublicIds } from '@/lib/services/products'
import { listPrices } from '@/lib/operations/catalog'
import { priceWireSchema, priceWireToInput } from '@/lib/validators'

/** GET /api/v1/prices?product=&active=&currency=&type=&cursor=&limit= */
export const GET = withApi({ scope: 'products:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const active = params.get('active')

  return json(
    await listPrices(ctx, {
      product: params.get('product'),
      active: active === null ? undefined : active === 'true',
      currency: params.get('currency'),
      type: params.get('type'),
      cursor: params.get('cursor'),
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    }),
  )
})

/** POST /api/v1/prices — `unit_amount` in minor units, like Stripe. */
export const POST = withApi({ scope: 'products:write', idempotent: 'optional' }, async (ctx, request) => {
  const wire = parseWire(priceWireSchema, (await readJson(request)) as unknown)
  const price = await prices.create(ctx, priceWireToInput(wire))
  const productNames = await mapPublicIds(ctx, [price.product_id])

  return json({ data: serializePrice(price, productNames.get(price.product_id) ?? null) }, { status: 201 })
})
