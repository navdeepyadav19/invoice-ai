import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeProduct } from '@/lib/api/serialize'
import * as products from '@/lib/services/products'
import { productSchema } from '@/lib/validators'

/** GET /api/v1/products?query=&active=&cursor=&limit= */
export const GET = withApi({ scope: 'products:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const active = params.get('active')

  const page = await products.list(ctx, {
    query: params.get('query') ?? undefined,
    active: active === null ? undefined : active === 'true',
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })

  return json({ data: page.data.map(serializeProduct), next_cursor: page.next_cursor })
})

/** POST /api/v1/products */
export const POST = withApi({ scope: 'products:write', idempotent: 'optional' }, async (ctx, request) => {
  const body = parseWire(productSchema, (await readJson(request)) as unknown)
  const product = await products.create(ctx, body)

  return json({ data: serializeProduct(product) }, { status: 201 })
})
