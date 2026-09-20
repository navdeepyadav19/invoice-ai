import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, notFound, ServiceError } from '@/lib/services/errors'
import { decodeCursor, encodeCursor, type Page } from '@/lib/services/pagination'
import { productSchema, type ProductInput } from '@/lib/validators'
import { nextProductId, isProductId } from '@/lib/catalog/ids'
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

  let q = ctx.supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (options.active !== undefined) q = q.eq('active', options.active)

  if (options.query) {
    const term = options.query.replace(/[%_]/g, (m) => `\\${m}`)
    q = q.ilike('name', `%${term}%`)
  }

  const after = decodeCursor(options.cursor)
  if (after) {
    q = q.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`)
  }

  const { data, error } = await q
  if (error) throw fromPostgres(error)

  return toPage((data ?? []) as ProductRow[], limit)
}

/** Find by UUID or `prod_…` public ID. */
export async function get(ctx: AuthContext, id: string): Promise<ProductRow> {
  requireScope(ctx, 'products:read')

  const q = ctx.supabase.from('products').select('*')
  const { data, error } = isProductId(id)
    ? await q.eq('public_id', id).maybeSingle()
    : await q.eq('id', id).maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Product not found.')

  return data as ProductRow
}

export async function create(ctx: AuthContext, input: ProductInput): Promise<ProductRow> {
  requireScope(ctx, 'products:write')

  const parsed = productSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const { data, error } = await ctx.supabase
    .from('products')
    .insert({
      owner_id: ctx.userId,
      public_id: nextProductId(),
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      images: parsed.data.images,
      active: parsed.data.active,
    })
    .select('*')
    .single()

  if (error) throw fromPostgres(error)
  return data as ProductRow
}

export async function update(
  ctx: AuthContext,
  id: string,
  input: Partial<ProductInput>,
): Promise<ProductRow> {
  requireScope(ctx, 'products:write')

  const parsed = productSchema.partial().safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const existing = await get(ctx, id)

  const { data, error } = await ctx.supabase
    .from('products')
    .update({
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.description !== undefined
        ? { description: parsed.data.description ?? null }
        : {}),
      ...(parsed.data.images !== undefined ? { images: parsed.data.images } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
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

  const { data, error } = await ctx.supabase
    .from('products')
    .update({ active })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Product not found.')

  return data as ProductRow
}

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}

function toPage<T extends { created_at: string; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data.at(-1)

  return {
    data,
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): ServiceError {
  return new ServiceError(
    'validation',
    'Some fields need attention.',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  )
}
