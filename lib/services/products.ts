import { requireScope, type AuthContext } from '@/lib/auth/context'
import { notFound, q, ServiceError } from '@/lib/services/errors'
import { afterPosition, clampLimit, parseCursor, toPage, type Page } from '@/lib/services/pagination'
import {
  productSchema,
  productUpdateSchema,
  type ProductInput,
  type ProductUpdateInput,
} from '@/lib/validators'
import { nextProductId, isProductId, isUuid } from '@/lib/catalog/ids'
import type { ProductRow } from '@/lib/database.types'

/**
 * Products — the named things you sell.
 *
 * A product never carries money itself; that lives on its prices. Archiving
 * hides it without breaking issued invoices that already reference it.
 */

export interface ListProductsOptions {
  query?: string
  active?: boolean
  cursor?: string | null
  limit?: number
}

export async function list(ctx: AuthContext, options: ListProductsOptions = {}): Promise<Page<ProductRow>> {
  requireScope(ctx, 'products:read')

  const limit = clampLimit(options.limit)

  let query = ctx.db
    .selectFrom('products')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)

  if (options.active !== undefined) query = query.where('active', '=', options.active)

  if (options.query) {
    const term = options.query.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.where('name', 'ilike', `%${term}%`)
  }

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())

  return toPage(data as ProductRow[], limit)
}

/** Find by UUID or `prod_…` public ID. */
export async function get(ctx: AuthContext, id: string): Promise<ProductRow> {
  requireScope(ctx, 'products:read')

  if (!isProductId(id) && !isUuid(id)) throw notFound('Product not found.')

  const data = await q(
    ctx.db
      .selectFrom('products')
      .selectAll()
      .where(isProductId(id) ? 'public_id' : 'id', '=', id)
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Product not found.')

  return data as ProductRow
}

export async function create(ctx: AuthContext, input: ProductInput): Promise<ProductRow> {
  requireScope(ctx, 'products:write')

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const data = await q(
    ctx.db
      .insertInto('products')
      .values({
        owner_id: ctx.userId,
        public_id: nextProductId(),
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        // jsonb array: stringify, or node-postgres sends a Postgres array literal.
        images: JSON.stringify(parsed.data.images),
        active: parsed.data.active,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  )

  return data as ProductRow
}

export async function update(
  ctx: AuthContext,
  id: string,
  input: ProductUpdateInput,
): Promise<ProductRow> {
  requireScope(ctx, 'products:write')

  // Not productSchema.partial(): that would re-apply the create defaults
  // (active: true, images: []) to every PATCH that omits them.
  const parsed = productUpdateSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const existing = await get(ctx, id)

  const data = await q(
    ctx.db
      .updateTable('products')
      .set({
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description ?? null }
          : {}),
        ...(parsed.data.images !== undefined ? { images: JSON.stringify(parsed.data.images) } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Product not found.')

  return data as ProductRow
}

/**
 * Archive, not delete — issued invoices reference products through their
 * lines. Archiving twice succeeds so retries are safe.
 */
export async function archive(ctx: AuthContext, id: string): Promise<ProductRow> {
  return setActive(ctx, id, false)
}
export async function restore(ctx: AuthContext, id: string): Promise<ProductRow> {
  return setActive(ctx, id, true)
}

async function setActive(ctx: AuthContext, id: string, active: boolean): Promise<ProductRow> {
  requireScope(ctx, 'products:write')

  const existing = await get(ctx, id)
  if (existing.active === active) return existing

  const data = await q(
    ctx.db
      .updateTable('products')
      .set({ active })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Product not found.')

  return data as ProductRow
}

/**
 * UUID → `prod_…` for a batch of product rows. Used when serializing prices
 * and invoice lines Stripe-style.
 */
export async function mapPublicIds(ctx: AuthContext, ids: string[]): Promise<Map<string, string>> {
  requireScope(ctx, 'products:read')

  const unique = [...new Set(ids)]
  const map = new Map<string, string>()
  if (unique.length === 0) return map

  const data = await q(
    ctx.db.selectFrom('products').select(['id', 'public_id']).where('id', 'in', unique).execute(),
  )

  for (const row of data) {
    map.set(row.id, row.public_id)
  }
  return map
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): ServiceError {
  return new ServiceError(
    'validation',
    'Some fields need attention.',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  )
}
