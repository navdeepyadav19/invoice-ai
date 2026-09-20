import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializePrice } from '@/lib/api/serialize'
import * as prices from '@/lib/services/prices'
import { mapPublicIds } from '@/lib/services/products'
import { priceWireSchema, priceWirePartialToInput, type PriceWireInput } from '@/lib/validators'

type Params = { id: string }

/** GET /api/v1/prices/{id} — `price_…` or UUID. */
export const GET = withApi<Params>({ scope: 'products:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  const price = await prices.get(ctx, id)
  const productNames = await mapPublicIds(ctx, [price.product_id])

  return json({ data: serializePrice(price, productNames.get(price.product_id) ?? null) })
})

/** PATCH /api/v1/prices/{id} — the parent product cannot change. */
export const PATCH = withApi<Params>({ scope: 'products:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const wire = parseWire(priceWireSchema.partial(), (await readJson(request)) as unknown) as Partial<PriceWireInput>

  const price = await prices.update(ctx, id, priceWirePartialToInput(wire))
  const productNames = await mapPublicIds(ctx, [price.product_id])

  return json({ data: serializePrice(price, productNames.get(price.product_id) ?? null) })
})

/**
 * DELETE /api/v1/prices/{id}
 *
 * Archives rather than deletes: invoice lines may reference the price.
 */
export const DELETE = withApi<Params>({ scope: 'products:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  const price = await prices.archive(ctx, id)
  const productNames = await mapPublicIds(ctx, [price.product_id])

  return json({ data: serializePrice(price, productNames.get(price.product_id) ?? null) })
})
