'use server'

import { contextFromSession } from '@/lib/auth/context'
import { getCurrentUser } from '@/lib/queries'
import * as clients from '@/lib/services/clients'
import { fromPostgres } from '@/lib/services/errors'
import { sanitizeSearchTerm, type CustomerOption, type PriceOption } from '@/lib/catalog/picker'
import type { ClientRow, PriceRow } from '@/lib/database.types'

/**
 * Typeahead searches for the invoice builder's pickers.
 *
 * Both run as the signed-in user (RLS does the tenant isolation), return at
 * most SEARCH_LIMIT small serializable rows, and never throw: a failed search
 * comes back as `{ results: [], error }` with a friendly message, because a
 * typeahead that crashes the builder is worse than one that finds nothing.
 */

const SEARCH_LIMIT = 10

export interface SearchResult<T> {
  results: T[]
  error?: string
}

/** Saved customers whose name contains `query` (most recent first when empty). Archived ones are hidden. */
export async function searchCustomers(query: string): Promise<SearchResult<CustomerOption>> {
  if (!(await getCurrentUser())) return { results: [] }

  try {
    const ctx = await contextFromSession()
    const page = await clients.list(ctx, {
      query: typeof query === 'string' ? query.trim().slice(0, 100) || undefined : undefined,
      limit: SEARCH_LIMIT,
    })
    return { results: page.data.map(toCustomerOption) }
  } catch (cause) {
    return searchFailed('customers', cause)
  }
}

/**
 * Active prices on active products, matched by product name or price
 * nickname. The invoice currency is not filtered on here — the picker shows
 * other-currency prices disabled, so "why isn't my price listed?" never
 * comes up.
 */
export async function searchPrices(query: string): Promise<SearchResult<PriceOption>> {
  if (!(await getCurrentUser())) return { results: [] }

  try {
    const ctx = await contextFromSession()
    const term = sanitizeSearchTerm(typeof query === 'string' ? query : '')

    let q = ctx.supabase
      .from('prices')
      .select('*, products!inner(name, active)')
      .eq('active', true)
      .eq('products.active', true)
      .order('created_at', { ascending: false })
      .limit(SEARCH_LIMIT)

    if (term) {
      // A price matches on its product's name or its own nickname. The
      // product side is a separate lookup because PostgREST can't OR across
      // an embedded resource.
      const { data: products, error } = await ctx.supabase
        .from('products')
        .select('id')
        .eq('active', true)
        .ilike('name', `%${term}%`)
        .limit(50)
      if (error) throw fromPostgres(error)

      const ids = (products ?? []).map((row) => (row as { id: string }).id)
      // Quoted so a term with a dot or space stays one value in the or= tree.
      const filters = [`nickname.ilike."%${term}%"`]
      if (ids.length > 0) filters.push(`product_id.in.(${ids.join(',')})`)
      q = q.or(filters.join(','))
    }

    const { data, error } = await q
    if (error) throw fromPostgres(error)

    type Joined = PriceRow & { products: { name: string } | Array<{ name: string }> | null }
    return {
      results: ((data ?? []) as unknown as Joined[]).map((row) => {
        const product = Array.isArray(row.products) ? row.products[0] : row.products
        return toPriceOption(row, product?.name ?? '')
      }),
    }
  } catch (cause) {
    return searchFailed('prices', cause)
  }
}

/**
 * Log the real cause; show a sentence. `fromPostgres` keeps the database's
 * message on the error, which is fine for a log line and wrong for a dropdown.
 */
function searchFailed<T>(what: string, cause: unknown): SearchResult<T> {
  console.error('[catalog-search] %s search failed', what, cause)
  return { results: [], error: `Couldn't search ${what} right now. Try again in a moment.` }
}

function toCustomerOption(row: ClientRow): CustomerOption {
  return {
    id: row.public_id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tax_id: row.tax_id,
    address_line1: row.address_line1,
    address_line2: row.address_line2,
    city: row.city,
    region: row.region,
    postal_code: row.postal_code ?? row.pincode,
    country_code: row.country_code,
  }
}

function toPriceOption(row: PriceRow, productName: string): PriceOption {
  return {
    id: row.public_id,
    productName,
    nickname: row.nickname,
    unitAmount: Number(row.unit_amount),
    currency: row.currency,
    taxRate: Number(row.tax_rate),
    type: row.type,
    interval: row.recurring_interval,
    intervalCount: Number(row.interval_count) || 1,
  }
}
