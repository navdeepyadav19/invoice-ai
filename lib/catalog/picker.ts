import { localeForCurrency } from '@/lib/locale/countries'
import type { LineItemFormValue } from '@/lib/invoice-form'

/**
 * Pure helpers behind the invoice builder's "saved customer" and "add from
 * catalog" pickers. No I/O and no React, so the rules are unit-testable:
 * how a price reads, when it can't be used, and what a pick writes into the
 * form.
 */

/** A saved customer as the picker sees it — serializable, no internal UUID. */
export interface CustomerOption {
  /** `cus_…` public id. */
  id: string
  name: string
  email: string | null
  phone: string | null
  tax_id: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  region: string | null
  postal_code: string | null
  country_code: string | null
}

/** An active catalog price as the picker sees it. */
export interface PriceOption {
  /** `price_…` public id — what an invoice line references. */
  id: string
  productName: string
  nickname: string | null
  unitAmount: number
  currency: string
  taxRate: number
  type: 'one_time' | 'recurring'
  interval: 'day' | 'week' | 'month' | 'year' | null
  intervalCount: number
}

/** The client block of the builder form. */
export interface ClientFormValue {
  name: string
  tax_id: string
  email: string
  phone: string
  address_line1: string
  address_line2: string
  city: string
  region: string
  postal_code: string
  country_code: string
}

/**
 * "₹2,500 / month", "$99.50", "€1,200 every 3 months".
 *
 * Whole amounts drop the ".00" — a picker row is read at a glance, and the
 * line it creates carries the exact figure anyway.
 */
export function formatPriceLabel(
  price: Pick<PriceOption, 'unitAmount' | 'currency' | 'type' | 'interval' | 'intervalCount'>,
): string {
  const amount = formatAmount(price.unitAmount, price.currency)
  if (price.type !== 'recurring' || !price.interval) return amount

  const count = Math.max(1, Math.trunc(price.intervalCount || 1))
  return count === 1 ? `${amount} / ${price.interval}` : `${amount} every ${count} ${price.interval}s`
}

function formatAmount(value: number, currency: string): string {
  const code = currency.toUpperCase()
  const whole = Number.isInteger(value)
  try {
    return new Intl.NumberFormat(localeForCurrency(code), {
      style: 'currency',
      currency: code,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value)
  } catch {
    // An unknown ISO code throws in Intl; show the raw figure rather than crash.
    return `${code} ${value}`
  }
}

/**
 * True when a catalog price can't go on this invoice. There is no FX in this
 * product — the server rejects a mismatch — so the picker says so up front.
 */
export function isCurrencyMismatch(priceCurrency: string | null | undefined, invoiceCurrency: string): boolean {
  if (!priceCurrency) return false
  return priceCurrency.trim().toUpperCase() !== invoiceCurrency.trim().toUpperCase()
}

/** The builder line a picked price becomes. Description/rate/tax are prefilled but stay editable. */
export function priceToLineItem(price: PriceOption): LineItemFormValue {
  return {
    description: price.nickname ? `${price.productName} — ${price.nickname}` : price.productName,
    quantity: '1',
    unit: 'NOS',
    rate: String(price.unitAmount),
    discount_percent: '0',
    tax_rate: String(price.taxRate),
    price: price.id,
    price_currency: price.currency.toUpperCase(),
    price_label: formatPriceLabel(price),
  }
}

/**
 * Only the untouched starter row is replaced by a pick; anything the user has
 * typed into is kept and the price is appended after it.
 */
export function isBlankLine(line: Pick<LineItemFormValue, 'description' | 'rate' | 'price'>): boolean {
  return !line.price && !line.description.trim() && !String(line.rate ?? '').trim()
}

/** What selecting a saved customer writes into the form. */
export function customerToFormClient(customer: CustomerOption, fallbackCountry: string): ClientFormValue {
  return {
    name: customer.name,
    tax_id: customer.tax_id ?? '',
    email: customer.email ?? '',
    phone: customer.phone ?? '',
    address_line1: customer.address_line1 ?? '',
    address_line2: customer.address_line2 ?? '',
    city: customer.city ?? '',
    region: customer.region ?? '',
    postal_code: customer.postal_code ?? '',
    country_code: customer.country_code || fallbackCountry,
  }
}

const CLIENT_KEYS: Array<keyof ClientFormValue> = [
  'name',
  'tax_id',
  'email',
  'phone',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country_code',
]

/**
 * Has the user edited the Bill-to block since picking a saved customer?
 *
 * Whitespace-insensitive at the ends (the server trims) and case-insensitive
 * on country, so an untouched pick never reads as an edit.
 */
export function clientDiffers(current: Partial<ClientFormValue> | undefined, snapshot: ClientFormValue): boolean {
  return CLIENT_KEYS.some((key) => {
    const a = String(current?.[key] ?? '').trim()
    const b = String(snapshot[key] ?? '').trim()
    return key === 'country_code' ? a.toUpperCase() !== b.toUpperCase() : a !== b
  })
}

/**
 * The `customer` field sent with a draft save.
 *
 *   'cus_…'    point the draft at this saved customer; its row is left alone
 *   null       the draft was linked but no longer is — give it a fresh row
 *   undefined  never linked — existing behaviour (the draft's own row)
 */
export function customerLinkForSave(
  linkedCustomerId: string | null,
  persistedCustomerId: string | null,
): string | null | undefined {
  if (linkedCustomerId) return linkedCustomerId
  if (persistedCustomerId) return null
  return undefined
}

/**
 * Is the client row a stored draft points at a *saved customer* (reused, so
 * never overwritten from the builder) or the draft's own snapshot row?
 *
 * The draft's own row is inserted in the same request as the invoice, so it
 * is at most moments older than the invoice. A row that predates the invoice
 * by more than that — or that another invoice also points at — was picked
 * from the saved customers.
 */
export function isSavedCustomerLink(input: {
  clientCreatedAt: string
  invoiceCreatedAt: string
  otherInvoiceCount: number
}): boolean {
  if (input.otherInvoiceCount > 0) return true
  const client = Date.parse(input.clientCreatedAt)
  const invoice = Date.parse(input.invoiceCreatedAt)
  if (Number.isNaN(client) || Number.isNaN(invoice)) return false
  return invoice - client > OWN_ROW_WINDOW_MS
}

const OWN_ROW_WINDOW_MS = 5_000

/** Escape PostgREST pattern wildcards and drop characters that break an `or=` filter. */
export function sanitizeSearchTerm(query: string): string {
  return query
    .trim()
    .slice(0, 100)
    .replace(/[,()"'\\*:]/g, ' ')
    .replace(/[%_]/g, (m) => `\\${m}`)
    .replace(/\s+/g, ' ')
    .trim()
}
