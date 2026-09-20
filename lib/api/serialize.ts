import { invoiceTotalsToPaise, lineItemAmountsToPaise } from '@/lib/money-api'
import { deriveStatus } from '@/lib/invoice-status'
import type {
  BusinessRow,
  ClientRow,
  InvoiceEventRow,
  InvoiceItemRow,
  InvoiceRow,
} from '@/lib/database.types'

/**
 * Row → wire.
 *
 * Serialisers exist so the database schema and the public API contract can move
 * independently. A column rename is a refactor; a field rename in here is a
 * breaking change that needs a /v2. Keeping them separate makes that distinction
 * visible instead of accidental.
 *
 * Two conversions happen at this boundary and nowhere else:
 *
 *   money   numeric(14,2) major units  →  integer minor units (`*_paise`)
 *   status  the stored column          →  deriveStatus(), so `overdue` appears
 */

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

export function serializeClient(row: ClientRow) {
  return {
    id: row.id,
    name: row.name,
    tax_id: row.tax_id,
    email: row.email,
    phone: row.phone,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      region: row.region,
      postal_code: (row.postal_code ?? row.pincode) as string | null,
      country_code: row.country_code,
      country: row.country,
    },
    archived: Boolean(row.archived_at),
    archived_at: row.archived_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export function serializeLineItem(row: InvoiceItemRow) {
  return {
    id: row.id,
    position: row.position,
    description: row.description,
    quantity: Number(row.quantity),
    unit: row.unit,
    // Rate is money too: $25,000/unit is 2500000 minor units on the wire.
    rate_paise: Math.round(Number(row.rate) * 100),
    discount_percent: Number(row.discount_percent),
    tax_rate: Number(row.tax_rate ?? row.gst_rate ?? 0),
    product_id: row.product_id,
    price_id: row.price_id,
    ...lineItemAmountsToPaise(row),
  }
}

export function serializeInvoice(row: InvoiceRow, items?: InvoiceItemRow[]) {
  return {
    id: row.id,
    // Null until issued. An integrator keying on this must handle null, which
    // is exactly the point: a draft has no number because none was spent on it.
    invoice_number: row.invoice_number,
    // The stored column is never 'overdue' — it is computed from due_date at
    // read time, so it can change without anything writing to the row.
    status: deriveStatus(row),
    client_id: row.client_id,
    issue_date: row.issue_date,
    due_date: row.due_date,
    currency: row.currency,
    notes: row.notes,
    terms: row.terms,
    ...invoiceTotalsToPaise(row),
    amount_in_words: row.amount_in_words,
    public_url_token: row.public_token,
    issued_at: row.sent_at,
    paid_at: row.paid_at,
    cancelled_at: row.cancelled_at,
    cancel_reason: row.cancel_reason,
    created_at: row.created_at,
    updated_at: row.updated_at,
    ...(items ? { items: items.map(serializeLineItem) } : {}),
  }
}

/**
 * The stored enum value is `sent`; the API calls it `issued`.
 *
 * `sent` was named for the UI button and means "has an invoice number" — which
 * is not the same as "the email went out". Translating at the edge means
 * integrators subscribing to invoice.issued and invoice.emailed get the two
 * facts separately, without us rewriting historical rows.
 */
const EVENT_NAMES: Record<InvoiceEventRow['type'], string> = {
  created: 'invoice.created',
  sent: 'invoice.issued',
  updated: 'invoice.updated',
  emailed: 'invoice.emailed',
  email_failed: 'invoice.email_failed',
  viewed: 'invoice.viewed',
  downloaded: 'invoice.downloaded',
  paid: 'invoice.paid',
  cancelled: 'invoice.cancelled',
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
