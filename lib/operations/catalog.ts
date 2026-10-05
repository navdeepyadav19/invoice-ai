import { serializeBusiness, serializePrice, serializeProduct } from '@/lib/api/serialize'
import type { AuthContext } from '@/lib/auth/context'
import * as businesses from '@/lib/services/business'
import * as prices from '@/lib/services/prices'
import * as products from '@/lib/services/products'

/** Business, product and price reads shared by REST and MCP. See lib/operations/invoices.ts. */

export async function retrieveBusiness(ctx: AuthContext) {
  return { data: serializeBusiness(await businesses.getPrimary(ctx)) }
}

export async function listProducts(
  ctx: AuthContext,
  input: { query?: string | null; active?: boolean; cursor?: string | null; limit?: number },
) {
  const page = await products.list(ctx, {
    query: input.query ?? undefined,
    active: input.active,
    cursor: input.cursor ?? null,
    limit: input.limit,
  })

  return { data: page.data.map(serializeProduct), next_cursor: page.next_cursor }
}

export async function listPrices(
  ctx: AuthContext,
  input: {
    product?: string | null
    active?: boolean
    currency?: string | null
    type?: string | null
    cursor?: string | null
    limit?: number
  },
) {
  const page = await prices.list(ctx, {
    product: input.product ?? undefined,
    active: input.active,
    currency: input.currency ?? undefined,
    type: input.type === 'one_time' || input.type === 'recurring' ? input.type : undefined,
    cursor: input.cursor ?? null,
    limit: input.limit,
  })

  const productIds = await products.mapPublicIds(
    ctx,
    page.data.map((p) => p.product_id),
  )

  return {
    data: page.data.map((p) => serializePrice(p, productIds.get(p.product_id) ?? null)),
    next_cursor: page.next_cursor,
  }
}
