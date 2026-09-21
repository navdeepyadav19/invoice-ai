import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeProduct } from '@/lib/api/serialize'
import * as products from '@/lib/services/products'
import { productUpdateSchema } from '@/lib/validators'

type Params = { id: string }

/** GET /api/v1/products/{id} — `prod_…` or UUID. */
export const GET = withApi<Params>({ scope: 'products:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeProduct(await products.get(ctx, id)) })
})

/** PATCH /api/v1/products/{id} */
export const PATCH = withApi<Params>({ scope: 'products:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const body = parseWire(productUpdateSchema, (await readJson(request)) as unknown)

  return json({ data: serializeProduct(await products.update(ctx, id, body)) })
})

/**
 * DELETE /api/v1/products/{id}
 *
 * Archives rather than deletes: prices and invoice lines reference the
 * product. Like Stripe, the row stays with `active: false`.
 */
export const DELETE = withApi<Params>({ scope: 'products:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeProduct(await products.archive(ctx, id)) })
})
