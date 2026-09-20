import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, notFound, ServiceError } from '@/lib/services/errors'
import { decodeCursor, encodeCursor, type Page } from '@/lib/services/pagination'
import { priceSchema, type PriceInput } from '@/lib/validators'
import { nextPriceId, isPriceId, isProductId } from '@/lib/catalog/ids'
import { get as getProduct } from '@/lib/services/products'
import type { PriceRow } from '@/lib/database.types'

/**
 * Prices — the ways to charge for a product.
 *
 * One product, many prices: monthly vs yearly, USD vs EUR, an old price kept
 * for existing customers while new ones see the new one. The parent product is
 * immutable after creation; everything else can change until the price is
 * referenced by an issued invoice (enforced by convention, not by the database).
 */

export interface ListPricesOptions {
  product?: string
  active?: boolean
  currency?: string
  type?: 'one_time' | 'recurring'
  cursor?: string | null
  limit?: number
}

export async function list(ctx: AuthContext, options: ListPricesOptions = {}): Promise<Page<PriceRow>> {
  requireScope(ctx, 'products:read')

  const limit = clampLimit(options.limit)

  let q = ctx.supabase
    .from('prices')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1)

  if (options.product) {
    // Accept UUID or prod_…; resolve first so a wrong id is a 404, not an
    // empty page that looks like "no prices yet".
    const product = await getProduct(ctx, options.product)
    q = q.eq('product_id', product.id)
  }
  if (options.active !== undefined) q = q.eq('active', options.active)
  if (options.currency) q = q.eq('currency', options.currency.toUpperCase())
  if (options.type) q = q.eq('type', options.type)

  const after = decodeCursor(options.cursor)
  if (after) {
    q = q.or(`created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`)
  }

  const { data, error } = await q
  if (error) throw fromPostgres(error)

  return toPage((data ?? []) as PriceRow[], limit)
}

/** Find by UUID or `price_…` public ID. */
export async function get(ctx: AuthContext, id: string): Promise<PriceRow> {
  requireScope(ctx, 'products:read')

  const q = ctx.supabase.from('prices').select('*')
  const { data, error } = isPriceId(id)
    ? await q.eq('public_id', id).maybeSingle()
    : await q.eq('id', id).maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Price not found.')

  return data as PriceRow
}

/** Prices with their product names — what invoice lines resolve against. */
export async function getManyWithProducts(
  ctx: AuthContext,
  ids: string[],
): Promise<Array<PriceRow & { product_name: string }>> {
  requireScope(ctx, 'invoices:write')

  const unique = [...new Set(ids)]
  if (unique.length === 0) return []

  const orFilter = unique
    .map((id) => (isPriceId(id) ? `public_id.eq.${id}` : `id.eq.${id}`))
    .join(',')

  const { data, error } = await ctx.supabase
    .from('prices')
    .select('*, products!inner(name)')
    .or(orFilter)

  if (error) throw fromPostgres(error)

  type JoinedPrice = PriceRow & { products: { name: string } | Array<{ name: string }> }
  return ((data ?? []) as unknown as JoinedPrice[]).map((row) => {
    const product = Array.isArray(row.products) ? row.products[0] : row.products
    return { ...row, product_name: product?.name ?? '' }
  })
}

export async function create(ctx: AuthContext, input: PriceInput): Promise<PriceRow> {
  requireScope(ctx, 'products:write')

  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const product = await getProduct(ctx, parsed.data.product)

  const { data, error } = await ctx.supabase
    .from('prices')
    .insert({
      owner_id: ctx.userId,
      public_id: nextPriceId(),
      product_id: product.id,
      nickname: parsed.data.nickname ?? null,
      unit_amount: parsed.data.unit_amount,
      currency: parsed.data.currency,
      type: parsed.data.type,
      recurring_interval: parsed.data.recurring_interval ?? null,
      interval_count: parsed.data.interval_count,
      tax_rate: parsed.data.tax_rate,
      active: parsed.data.active,
    })
    .select('*')
    .single()

  if (error) throw fromPostgres(error)
  return data as PriceRow
}

export async function update(
  ctx: AuthContext,
  id: string,
  input: Partial<PriceInput>,
): Promise<PriceRow> {
  requireScope(ctx, 'products:write')

  if (input.product !== undefined) {
    throw new ServiceError('validation', 'A price cannot move to another product.', [
      { path: 'product', message: 'Create a new price on the other product instead.' },
    ])
  }

  const parsed = priceSchema
    .partial()
    .superRefine((value, issues) => {
      if (value.type === 'recurring' && !value.recurring_interval) {
        issues.addIssue({
          code: 'custom',
          path: ['recurring_interval'],
          message: 'Pick how often this price recurs',
        })
      }
    })
    .safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const existing = await get(ctx, id)

  const { data, error } = await ctx.supabase
    .from('prices')
    .update({
      ...(parsed.data.nickname !== undefined ? { nickname: parsed.data.nickname ?? null } : {}),
      ...(parsed.data.unit_amount !== undefined ? { unit_amount: parsed.data.unit_amount } : {}),
      ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
      ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
      ...(parsed.data.recurring_interval !== undefined
        ? { recurring_interval: parsed.data.recurring_interval ?? null }
        : {}),
      ...(parsed.data.interval_count !== undefined
        ? { interval_count: parsed.data.interval_count }
        : {}),
      ...(parsed.data.tax_rate !== undefined ? { tax_rate: parsed.data.tax_rate } : {}),
      ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
    })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Price not found.')

  return data as PriceRow
}

export async function archive(ctx: AuthContext, id: string): Promise<PriceRow> {
  return setActive(ctx, id, false)
}

export async function restore(ctx: AuthContext, id: string): Promise<PriceRow> {
  return setActive(ctx, id, true)
}

async function setActive(ctx: AuthContext, id: string, active: boolean): Promise<PriceRow> {
  requireScope(ctx, 'products:write')

  const existing = await get(ctx, id)
  if (existing.active === active) return existing

  const { data, error } = await ctx.supabase
    .from('prices')
    .update({ active })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Price not found.')

  return data as PriceRow
}

export function isUuidOrPublicId(value: string): boolean {
  return isPriceId(value) || isProductId(value)
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
