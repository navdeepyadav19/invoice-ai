'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { contextFromSession } from '@/lib/auth/context'
import { requireUser } from '@/lib/queries'
import * as products from '@/lib/services/products'
import * as prices from '@/lib/services/prices'
import { isServiceError } from '@/lib/services/errors'
import { toActionError } from '@/lib/actions/to-action-error'
import { toFieldErrors, withValues, type StepState } from '@/lib/form-state'
import { formatPriceLabel, parseMajorAmount } from '@/lib/catalog/price-format'
import {
  priceSchema,
  priceUpdateSchema,
  productSchema,
  productUpdateSchema,
  type PriceInput,
} from '@/lib/validators'
import type { PriceRecurringInterval } from '@/lib/database.types'

/**
 * Products & Prices from the dashboard.
 *
 * Thin translators over lib/services/products + prices (the same code the REST
 * API runs), shaped for the forms: failures come back as StepState with the
 * submission echoed so nothing typed is lost, and database errors are logged
 * and replaced with something a person can act on.
 *
 * Amounts arrive in MAJOR units ("2500" is ₹2,500) — the same unit the
 * services and the prices table use — and are checked against the currency's
 * decimals (no ¥5,000.50).
 */

/** Result of a one-click action (archive / restore). */
export interface CatalogActionResult {
  error?: string
}

/**
 * One active price as the invoice builder's picker needs it. Amounts are in
 * major units, like the rest of the builder. Pass `price_id` as an invoice
 * line's `price`.
 */
export interface PriceOption {
  /** `price_…` — what an invoice line's `price` field takes. */
  price_id: string
  price_uuid: string
  /** `prod_…` */
  product_id: string
  product_uuid: string
  product_name: string
  nickname: string | null
  /** "₹2,500/mo", "¥5,000" */
  label: string
  unit_amount: number
  currency: string
  tax_rate: number
  type: 'one_time' | 'recurring'
  recurring_interval: PriceRecurringInterval | null
  interval_count: number
}

/**
 * `formData.get()` is null for a field the form doesn't have; zod's
 * `.optional()` wants undefined. Every optional field reads through this.
 */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return value === null ? undefined : String(value)
}

/**
 * Don't hand raw Postgres/ServiceError text to the page ("new row violates
 * check constraint prices_…"). Field-level validation and not-found messages
 * are ours and safe to show; anything else is logged and replaced.
 */
function failed(cause: unknown, formData: FormData | null, fallback: string): StepState {
  let state: StepState
  if (isServiceError(cause) && cause.code === 'validation' && cause.details?.length) {
    state = toActionError(cause)
  } else if (isServiceError(cause) && (cause.code === 'not_found' || cause.code === 'forbidden')) {
    state = { error: cause.message }
  } else {
    console.error('[products] save failed', cause)
    state = { error: fallback }
  }
  return formData ? withValues(state, formData) : state
}

type ParsedPrice = { ok: true; data: PriceInput } | { ok: false; fieldErrors: Record<string, string> }

/** Read and validate the shared price fields (create only). */
function readPrice(formData: FormData, product: string): ParsedPrice {
  const currency = (field(formData, 'currency') ?? '').trim().toUpperCase()
  const amount = parseMajorAmount(field(formData, 'unit_amount') ?? '', currency || 'USD')
  const recurring = field(formData, 'type') === 'recurring'

  const parsed = priceSchema.safeParse({
    product,
    nickname: field(formData, 'nickname'),
    unit_amount: amount.ok ? amount.value : 0,
    currency,
    type: recurring ? 'recurring' : 'one_time',
    recurring_interval: recurring ? field(formData, 'recurring_interval') || undefined : undefined,
    interval_count: recurring ? field(formData, 'interval_count') || 1 : 1,
    tax_rate: field(formData, 'tax_rate') || 0,
  })

  const fieldErrors = parsed.success ? {} : (toFieldErrors(parsed.error).fieldErrors ?? {})
  if (!amount.ok) fieldErrors.unit_amount = amount.message

  if (parsed.success && amount.ok) return { ok: true, data: parsed.data }
  return { ok: false, fieldErrors }
}

function revalidateCatalog(productPublicId?: string) {
  revalidatePath('/products')
  if (productPublicId) revalidatePath(`/products/${productPublicId}`)
}

/**
 * /products/new — the product and its first price in one submit, like
 * Stripe's "Add product". Everything is validated before anything is written.
 */
export async function createProductAction(_prev: StepState, formData: FormData): Promise<StepState> {
  await requireUser()

  const product = productSchema.safeParse({
    name: field(formData, 'name'),
    description: field(formData, 'description'),
  })
  // Placeholder product ref: the real one only exists after the insert.
  const price = readPrice(formData, 'pending')

  if (!product.success || !price.ok) {
    return withValues(
      {
        error: 'Fix the highlighted fields and try again.',
        fieldErrors: {
          ...(product.success ? {} : toFieldErrors(product.error).fieldErrors),
          ...(price.ok ? {} : price.fieldErrors),
        },
      },
      formData,
    )
  }

  let publicId: string
  try {
    const ctx = await contextFromSession()
    const created = await products.create(ctx, product.data)
    publicId = created.public_id

    try {
      await prices.create(ctx, { ...price.data, product: created.id })
    } catch (cause) {
      // No transaction across the two inserts. Don't leave a live product
      // without a price behind: archive it (best effort) so a retry doesn't
      // show up as a duplicate in the active list.
      await products.archive(ctx, created.id).catch((error) => {
        console.error('[products] could not archive orphaned product', error)
      })
      return failed(cause, formData, "We couldn't save this product's price. Please try again.")
    }
  } catch (cause) {
    return failed(cause, formData, "We couldn't save this product. Please try again in a moment.")
  }

  revalidateCatalog()
  redirect(`/products/${publicId}`)
}

/** Name and description. Active is changed with archive/restore. */
export async function updateProductAction(
  productId: string,
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  await requireUser()

  const parsed = productUpdateSchema.safeParse({
    name: field(formData, 'name') ?? '',
    // "" clears the description (null), rather than meaning "unchanged".
    description: field(formData, 'description') ?? '',
  })
  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  try {
    const ctx = await contextFromSession()
    const product = await products.update(ctx, productId, parsed.data)
    revalidateCatalog(product.public_id)
  } catch (cause) {
    return failed(cause, formData, "We couldn't save your changes. Please try again in a moment.")
  }

  return { saved: true }
}

export async function setProductActiveAction(
  productId: string,
  active: boolean,
): Promise<CatalogActionResult> {
  await requireUser()

  try {
    const ctx = await contextFromSession()
    const product = active ? await products.restore(ctx, productId) : await products.archive(ctx, productId)
    revalidateCatalog(product.public_id)
    return {}
  } catch (cause) {
    const fallback = active ? "We couldn't restore this product." : "We couldn't archive this product."
    return { error: failed(cause, null, fallback).error }
  }
}

/** "Add price" on a product page. */
export async function createPriceAction(
  productId: string,
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  await requireUser()

  const price = readPrice(formData, productId)
  if (!price.ok) {
    return withValues(
      { error: 'Fix the highlighted fields and try again.', fieldErrors: price.fieldErrors },
      formData,
    )
  }

  try {
    const ctx = await contextFromSession()
    await prices.create(ctx, price.data)
    revalidateCatalog(productId)
  } catch (cause) {
    return failed(cause, formData, "We couldn't add this price. Please try again in a moment.")
  }

  return { saved: true }
}

/**
 * Nickname and tax rate only. Amount, currency and billing period are fixed
 * once a price exists (as in Stripe) — invoices already issued against it
 * must keep meaning what they said. Changing them means a new price.
 */
export async function updatePriceAction(
  productId: string,
  priceId: string,
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  await requireUser()

  const parsed = priceUpdateSchema.safeParse({
    nickname: field(formData, 'nickname') ?? '',
    tax_rate: field(formData, 'tax_rate') || 0,
  })
  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  try {
    const ctx = await contextFromSession()
    await prices.update(ctx, priceId, { nickname: parsed.data.nickname, tax_rate: parsed.data.tax_rate })
    revalidateCatalog(productId)
  } catch (cause) {
    return failed(cause, formData, "We couldn't save this price. Please try again in a moment.")
  }

  return { saved: true }
}

export async function setPriceActiveAction(
  productId: string,
  priceId: string,
  active: boolean,
): Promise<CatalogActionResult> {
  await requireUser()

  try {
    const ctx = await contextFromSession()
    if (active) await prices.restore(ctx, priceId)
    else await prices.archive(ctx, priceId)
    revalidateCatalog(productId)
    return {}
  } catch (cause) {
    const fallback = active ? "We couldn't restore this price." : "We couldn't archive this price."
    return { error: failed(cause, null, fallback).error }
  }
}

/**
 * Active prices of active products whose name matches `query` (all of them,
 * newest products first, when the query is empty). For the invoice builder's
 * line-item picker. `currency` narrows to prices the invoice can use — the
 * catalog does no FX.
 *
 * Never throws: a failed lookup logs and returns [] so a picker degrades to
 * "no matches" rather than crashing the builder.
 */
export async function searchPrices(
  query: string,
  options: { currency?: string; limit?: number } = {},
): Promise<PriceOption[]> {
  await requireUser()

  try {
    const ctx = await contextFromSession()
    const page = await products.list(ctx, {
      query: query.trim() || undefined,
      active: true,
      limit: Math.min(options.limit ?? 20, 50),
    })
    if (page.data.length === 0) return []

    const byId = new Map(page.data.map((p) => [p.id, p]))
    const rows = await prices.listForProducts(ctx, [...byId.keys()], { active: true })
    const currency = options.currency?.trim().toUpperCase()

    return rows
      .filter((price) => !currency || price.currency === currency)
      .map((price) => {
        const product = byId.get(price.product_id)!
        return {
          price_id: price.public_id,
          price_uuid: price.id,
          product_id: product.public_id,
          product_uuid: product.id,
          product_name: product.name,
          nickname: price.nickname,
          label: formatPriceLabel(price),
          unit_amount: Number(price.unit_amount),
          currency: price.currency,
          tax_rate: Number(price.tax_rate),
          type: price.type,
          recurring_interval: price.recurring_interval,
          interval_count: price.interval_count,
        }
      })
      .sort((a, b) => a.product_name.localeCompare(b.product_name))
  } catch (cause) {
    console.error('[products] price search failed', cause)
    return []
  }
}
