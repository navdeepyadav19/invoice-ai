import { invoiceTotalsToMinor, lineItemAmountsToMinor, storedToMinor } from '@/lib/money-api'
import { deriveStatus } from '@/lib/invoice-status'
import type {
  BusinessRow,
  ClientRow,
  InvoiceEventRow,
  InvoiceItemRow,
  InvoiceRow,
  PriceRow,
  ProductRow,
} from '@/lib/database.types'

/**
 * Row → wire, Stripe-shaped.
 *
 * Serialisers exist so the database schema and the public API contract can move
 * independently. The contract follows Stripe's resource and field names
 * (`customer`, `unit_amount`, `amount_due`, `prod_…` / `price_…` / `cus_…` /
 * `in_…` / `ii_…` IDs) while keeping this API's envelope (`{ data }`),
 * Bearer auth, and `application/problem+json` errors — see lib/api/openapi.ts.
 *
 * Two conversions happen at this boundary and nowhere else:
 *
 *   money   numeric(14,2) major units  →  integer minor units of the
 *           row's currency (lib/currency.ts: ¥5000 → 5000, $25.00 → 2500)
 *   status  the stored column          →  deriveStatus(), so `overdue` appears
 */

export interface CatalogMaps {
  customerPublicId?: string | null
  pricePublicById?: Map<string, string>
  productPublicById?: Map<string, string>
}

export function serializeBusiness(row: BusinessRow) {
  return {
    id: row.id,
    legal_name: row.legal_name,
    trade_name: row.trade_name,
    country_code: row.country_code,
    currency: row.currency,
    tax_id: row.tax_id,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      region: row.region,
      postal_code: (row.postal_code ?? row.pincode) as string | null,
      country_code: row.country_code,
      country: row.country,
    },
    email: row.email,
    phone: row.phone,
    bank: {
      bank_name: row.bank_name,
      account_name: row.account_name,
      account_number: row.account_number,
      routing_number: row.routing_number,
    },
    invoice_prefix: row.invoice_prefix,
    created_at: row.created_at,
  }
}

export function serializeCustomer(row: ClientRow) {
  return {
    id: row.public_id,
    object: 'customer' as const,
    name: row.name,
    email: row.email,
    phone: row.phone,
    tax_id: row.tax_id,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      state: row.region,
      postal_code: (row.postal_code ?? row.pincode) as string | null,
      country: row.country_code ?? row.country,
    },
    deleted: Boolean(row.archived_at),
    created: row.created_at,
  }
}

export function serializeProduct(row: ProductRow) {
  return {
    id: row.public_id,
    object: 'product' as const,
    name: row.name,
    description: row.description,
    images: (row.images ?? []) as string[],
    active: row.active,
    created: row.created_at,
    updated: row.updated_at,
  }
}

export function serializePrice(row: PriceRow, productPublicId?: string | null) {
  return {
    id: row.public_id,
    object: 'price' as const,
    product: productPublicId ?? null,
    nickname: row.nickname,
    unit_amount: storedToMinor(row.unit_amount, row.currency),
    currency: row.currency,
    billing_scheme: 'per_unit' as const,
    type: row.type,
    ...(row.type === 'recurring'
      ? { recurring: { interval: row.recurring_interval, interval_count: row.interval_count } }
      : { recurring: null }),
    tax_rate: Number(row.tax_rate),
    active: row.active,
    created: row.created_at,
  }
}

/** `currency` is the parent invoice's — a line has none of its own. */
export function serializeLineItem(row: InvoiceItemRow, currency: string, maps: CatalogMaps = {}) {
  const amounts = lineItemAmountsToMinor(row, currency)
  return {
    id: row.public_id,
    object: 'invoiceitem' as const,
    price: row.price_id ? (maps.pricePublicById?.get(row.price_id) ?? row.price_id) : null,
    product: row.product_id ? (maps.productPublicById?.get(row.product_id) ?? row.product_id) : null,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    unit_amount: amounts.unit_amount,
    amount: amounts.line_total,
    discount_percent: Number(row.discount_percent),
    tax_rate: Number(row.tax_rate ?? row.gst_rate ?? 0),
    tax_amount: amounts.tax_amount,
  }
}

export function serializeInvoice(row: InvoiceRow, items?: InvoiceItemRow[], maps: CatalogMaps = {}) {
  const totals = invoiceTotalsToMinor(row)
  const status = deriveStatus(row)

  return {
    id: row.public_id,
    object: 'invoice' as const,
    // Null until finalized. An integrator keying on this must handle null,
    // which is exactly the point: a draft has no number because none was spent.
    number: row.invoice_number,
    // The stored column is never 'overdue' — it is computed from due_date at
    // read time, so it can change without anything writing to the row.
    status,
    customer: maps.customerPublicId ?? row.client_id,
    currency: row.currency,
    collection_method: row.collection_method,
    issue_date: row.issue_date,
    due_date: row.due_date,
    description: row.notes,
    footer: row.terms,
    subtotal: totals.subtotal,
    discount: totals.discount_total,
    taxable: totals.taxable_total,
    tax: totals.tax_total,
    total: totals.total,
    // What is still owed. Drafts, paid and void invoices owe nothing.
    amount_due: status === 'open' || status === 'overdue' ? totals.total : 0,
    amount_in_words: row.amount_in_words,
    public_url_token: row.public_token,
    finalized_at: row.sent_at,
    paid_at: row.paid_at,
    voided_at: row.cancelled_at,
    void_reason: row.cancel_reason,
    created: row.created_at,
    updated: row.updated_at,
    ...(items ? { lines: { data: items.map((item) => serializeLineItem(item, row.currency, maps)) } } : {}),
  }
}

const EVENT_NAMES: Record<InvoiceEventRow['type'], string> = {
  created: 'invoice.created',
  finalized: 'invoice.finalized',
  updated: 'invoice.updated',
  emailed: 'invoice.emailed',
  email_failed: 'invoice.email_failed',
  viewed: 'invoice.viewed',
  downloaded: 'invoice.downloaded',
  paid: 'invoice.paid',
  voided: 'invoice.voided',
}

export function serializeEvent(row: InvoiceEventRow) {
  return {
    id: row.id,
    type: EVENT_NAMES[row.type] ?? row.type,
    meta: row.meta,
    created_at: row.created_at,
  }
}

export function eventName(type: InvoiceEventRow['type']): string {
  return EVENT_NAMES[type] ?? type
}
