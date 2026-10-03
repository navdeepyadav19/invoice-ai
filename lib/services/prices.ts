import { requireScope, type AuthContext } from '@/lib/auth/context'
import { notFound, q, ServiceError } from '@/lib/services/errors'
import { afterPosition, clampLimit, parseCursor, toPage, type Page } from '@/lib/services/pagination'
import {
  priceSchema,
  priceUpdateSchema,
  type PriceInput,
  type PriceUpdateInput,
} from '@/lib/validators'
import { nextPriceId, isPriceId, isUuid, isProductId } from '@/lib/catalog/ids'
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

  let query = ctx.db
    .selectFrom('prices')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)

  if (options.product) {
    // Accept UUID or prod_…; resolve first so a wrong id is a 404, not an
    // empty page that looks like "no prices yet".
    const product = await getProduct(ctx, options.product)
    query = query.where('product_id', '=', product.id)
  }
  if (options.active !== undefined) query = query.where('active', '=', options.active)
  if (options.currency) query = query.where('currency', '=', options.currency.toUpperCase())
  if (options.type) query = query.where('type', '=', options.type)

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())

  return toPage(data as PriceRow[], limit)
}

/**
 * Every price of a batch of products (by product UUID), newest first.
 *
 * For list screens that show a price summary per product without one query
 * per row. Unpaginated: a product has a handful of prices, and callers pass
 * one page of products at a time.
 */
export async function listForProducts(
  ctx: AuthContext,
  productIds: string[],
  options: { active?: boolean } = {},
): Promise<PriceRow[]> {
  requireScope(ctx, 'products:read')

  const unique = [...new Set(productIds)]
  if (unique.length === 0) return []

  let query = ctx.db
    .selectFrom('prices')
    .selectAll()
    .where('product_id', 'in', unique)
    .orderBy('created_at', 'desc')

  if (options.active !== undefined) query = query.where('active', '=', options.active)

  return (await q(query.execute())) as PriceRow[]
}

/** Find by UUID or `price_…` public ID. */
export async function get(ctx: AuthContext, id: string): Promise<PriceRow> {
  requireScope(ctx, 'products:read')

  if (!isPriceId(id) && !isUuid(id)) throw notFound('Price not found.')

  const data = await q(
    ctx.db
      .selectFrom('prices')
      .selectAll()
      .where(isPriceId(id) ? 'public_id' : 'id', '=', id)
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Price not found.')

  return data as PriceRow
}

/** Prices with their product names — what invoice lines resolve against. */
export async function getManyWithProducts(
  ctx: AuthContext,
  ids: string[],
): Promise<Array<PriceRow & { product_name: string }>> {
  requireScope(ctx, 'invoices:write')

  // A ref that is neither `price_…` nor a UUID can't match a row; dropping it
  // here lets the caller report "Unknown price." on that line instead of the
  // whole query failing on a uuid cast.
  const unique = [...new Set(ids)].filter((id) => isPriceId(id) || isUuid(id))
  if (unique.length === 0) return []

  const publicIds = unique.filter(isPriceId)
  const uuids = unique.filter((id) => !isPriceId(id))

  const data = await q(
    ctx.db
      .selectFrom('prices')
      .innerJoin('products', 'products.id', 'prices.product_id')
      .selectAll('prices')
      .select('products.name as product_name')
      .where((eb) =>
        eb.or([
          ...(publicIds.length > 0 ? [eb('prices.public_id', 'in', publicIds)] : []),
          ...(uuids.length > 0 ? [eb('prices.id', 'in', uuids)] : []),
        ]),
      )
      .execute(),
  )

  return data as Array<PriceRow & { product_name: string }>
}

export async function create(ctx: AuthContext, input: PriceInput): Promise<PriceRow> {
  requireScope(ctx, 'products:write')

  const parsed = priceSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const product = await getProduct(ctx, parsed.data.product)

  const data = await q(
    ctx.db
      .insertInto('prices')
      .values({
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
      .returningAll()
      .executeTakeFirstOrThrow(),
  )

  return data as PriceRow
}

export async function update(
  ctx: AuthContext,
  id: string,
  input: PriceUpdateInput,
): Promise<PriceRow> {
  requireScope(ctx, 'products:write')

  if (input.product !== undefined) {
    throw new ServiceError('validation', 'A price cannot move to another product.', [
      { path: 'product', message: 'Create a new price on the other product instead.' },
    ])
  }

  const existing = await get(ctx, id)

  // Not priceSchema.partial(): zod refuses .partial() on a refined object, and
  // even without the refinement it would re-apply create defaults — a
  // nickname-only PATCH would come out as type 'one_time' and wipe the
  // recurring interval. Omitted fields must mean "unchanged", and the
  // one-off/recurring check must look at the stored row for what was omitted.
  const parsed = priceUpdateSchema
    .superRefine((value, issues) => {
      const type = value.type ?? existing.type
      if (type === 'recurring' && !value.recurring_interval && !existing.recurring_interval) {
        issues.addIssue({
          code: 'custom',
          path: ['recurring_interval'],
          message: 'Pick how often this price recurs',
        })
      }
      if (type === 'one_time' && value.recurring_interval) {
        issues.addIssue({
          code: 'custom',
          path: ['recurring_interval'],
          message: 'One-off prices do not recur',
        })
      }
    })
    .safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  // Switching back to one-off must clear the interval, or the database
  // CHECK (recurring needs interval, one-off forbids it) rejects the row.
  const clearInterval = parsed.data.type === 'one_time'

  const data = await q(
    ctx.db
      .updateTable('prices')
      .set({
        ...(parsed.data.nickname !== undefined ? { nickname: parsed.data.nickname ?? null } : {}),
        ...(parsed.data.unit_amount !== undefined ? { unit_amount: parsed.data.unit_amount } : {}),
        ...(parsed.data.currency !== undefined ? { currency: parsed.data.currency } : {}),
        ...(parsed.data.type !== undefined ? { type: parsed.data.type } : {}),
        ...(clearInterval
          ? { recurring_interval: null, interval_count: 1 }
          : {
              ...(parsed.data.recurring_interval !== undefined
                ? { recurring_interval: parsed.data.recurring_interval ?? null }
                : {}),
              ...(parsed.data.interval_count !== undefined
                ? { interval_count: parsed.data.interval_count }
                : {}),
            }),
        ...(parsed.data.tax_rate !== undefined ? { tax_rate: parsed.data.tax_rate } : {}),
        ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
      })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

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

  const data = await q(
    ctx.db
      .updateTable('prices')
      .set({ active })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Price not found.')

  return data as PriceRow
}

export function isUuidOrPublicId(value: string): boolean {
  return isPriceId(value) || isProductId(value)
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): ServiceError {
  return new ServiceError(
    'validation',
    'Some fields need attention.',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  )
}
