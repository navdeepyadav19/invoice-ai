import { countryName } from '@/lib/locale/countries'
import { formatPaise, toPaise } from '@/lib/money'
import type { ClientInput } from '@/lib/validators'

/**
 * Pure helpers behind the /customers pages.
 *
 * Kept out of the 'use server' action module (which may only export async
 * functions) and free of Supabase, so they can be unit-tested directly.
 */

type SearchParams = Record<string, string | string[] | undefined>

export interface CustomerListParams {
  /** Free-text name search. Empty string means "no filter". */
  q: string
  /** Opaque cursor from the service's `next_cursor`. */
  cursor: string | null
  /** Show archived customers alongside active ones. */
  archived: boolean
}

function first(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

/** Read the list page's query string into typed, bounded values. */
export function parseCustomerListParams(searchParams: SearchParams): CustomerListParams {
  const q = first(searchParams.q).trim().slice(0, 100)
  const cursor = first(searchParams.cursor).trim()
  const archived = first(searchParams.archived)

  return {
    q,
    cursor: cursor || null,
    archived: archived === '1' || archived === 'true',
  }
}

/** Build a /customers URL, leaving out anything at its default. */
export function customersHref(params: Partial<CustomerListParams> = {}): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.archived) search.set('archived', '1')
  if (params.cursor) search.set('cursor', params.cursor)

  const query = search.toString()
  return query ? `/customers?${query}` : '/customers'
}

export interface InvoiceForSummary {
  client_id: string | null
  status: string
  total: number | string
  currency: string
}

export interface BilledSummary {
  /** Every invoice linked to the customer, drafts included. */
  count: number
  /** Finalized (open/paid) totals in minor units, keyed by currency. */
  billed: Record<string, number>
}

/**
 * Roll invoices up per customer.
 *
 * "Billed" means invoices that were actually issued: drafts haven't been sent
 * and a voided invoice was withdrawn, so neither counts toward the total.
 * Amounts stay split by currency — adding USD to EUR would be a made-up number.
 */
export function summarizeInvoices(invoices: readonly InvoiceForSummary[]): Map<string, BilledSummary> {
  const summaries = new Map<string, BilledSummary>()

  for (const invoice of invoices) {
    if (!invoice.client_id) continue

    let summary = summaries.get(invoice.client_id)
    if (!summary) {
      summary = { count: 0, billed: {} }
      summaries.set(invoice.client_id, summary)
    }

    summary.count += 1

    if (invoice.status === 'draft' || invoice.status === 'void') continue

    const total = Number(invoice.total)
    if (!Number.isFinite(total)) continue

    const currency = invoice.currency || 'USD'
    summary.billed[currency] = (summary.billed[currency] ?? 0) + toPaise(total)
  }

  return summaries
}

/** "$1,200.00", or "$1,200.00 + €300.00" for a customer billed in two currencies. */
export function formatBilled(billed: Record<string, number>): string {
  const entries = Object.entries(billed).filter(([, amount]) => amount !== 0)
  if (!entries.length) return '—'

  return entries
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatPaise(amount, currency))
    .join(' + ')
}

/**
 * A validated form submission as a full `clients` row update.
 *
 * The service's `update()` is PATCH-shaped: a blank optional field parses to
 * `undefined` and is left untouched, which is right for an API caller sending
 * one field and wrong for an edit form, where emptying the phone box means
 * "remove the phone number". Here every optional column is written, blank as
 * null.
 *
 * `country` (the legacy display-name column, NOT NULL) follows the code when
 * one is picked and is otherwise left alone.
 */
export function toClientRecord(input: ClientInput) {
  const code = input.country_code ? input.country_code.toUpperCase() : null

  return {
    name: input.name,
    email: input.email || null,
    phone: input.phone || null,
    tax_id: input.tax_id || null,
    address_line1: input.address_line1 || null,
    address_line2: input.address_line2 || null,
    city: input.city || null,
    region: input.region || null,
    postal_code: input.postal_code || null,
    country_code: code,
    ...(code ? { country: countryName(code) } : {}),
  }
}

/** The one-line address shown under a customer's name. */
export function formatClientAddress(client: {
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  region?: string | null
  postal_code?: string | null
  country_code?: string | null
}): string {
  return [
    client.address_line1,
    client.address_line2,
    client.city,
    [client.region, client.postal_code].filter(Boolean).join(' '),
    countryName(client.country_code),
  ]
    .map((part) => (part ?? '').trim())
    .filter(Boolean)
    .join(', ')
}
