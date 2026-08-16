import type { GstInvoiceResult } from '@/lib/gst'
import type { BusinessRow, InvoiceStatus, Json } from '@/lib/database.types'

/**
 * One shape that the live preview, the public page and the PDF all render from.
 *
 * The point is that a sent invoice must look identical in all three, forever.
 * If each surface built its own view model from the database rows, the PDF would
 * drift from the web page the first time someone added a field to one of them.
 */

// Type aliases, not interfaces, for the same reason as the database row types:
// only aliases get an implicit index signature, and these have to be assignable
// to `Json` when they're written into the invoice's snapshot columns.
export type PartySnapshot = {
  name: string
  trade_name?: string | null
  gstin?: string | null
  pan?: string | null
  address_line1?: string | null
  address_line2?: string | null
  city?: string | null
  state_code?: string | null
  pincode?: string | null
  country?: string | null
  email?: string | null
  phone?: string | null
}

export type PaymentSnapshot = {
  bank_name?: string | null
  account_name?: string | null
  account_number?: string | null
  ifsc?: string | null
  upi_id?: string | null
}

export type BusinessSnapshot = PartySnapshot & {
  logo_url?: string | null
  signature_url?: string | null
  is_gst_registered: boolean
  payment?: PaymentSnapshot
}

export type InvoiceView = {
  business: BusinessSnapshot
  client: PartySnapshot
  number: string | null
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  currency: string
  placeOfSupplyStateCode: string
  notes: string | null
  terms: string | null
  computed: GstInvoiceResult
  publicUrl?: string | null
}

/** Freeze the current business record into the shape stored on the invoice. */
export function snapshotBusiness(business: BusinessRow): BusinessSnapshot {
  return {
    name: business.legal_name,
    trade_name: business.trade_name,
    gstin: business.gstin,
    pan: business.pan,
    address_line1: business.address_line1,
    address_line2: business.address_line2,
    city: business.city,
    state_code: business.state_code,
    pincode: business.pincode,
    country: business.country,
    email: business.email,
    phone: business.phone,
    logo_url: business.logo_url,
    signature_url: business.signature_url,
    is_gst_registered: business.is_gst_registered,
    payment: {
      bank_name: business.bank_name,
      account_name: business.account_name,
      account_number: business.account_number,
      ifsc: business.ifsc,
      upi_id: business.upi_id,
    },
  }
}

/**
 * Read a snapshot back off a stored invoice.
 *
 * Snapshots are JSONB, so the database can hand back anything. Rather than
 * casting and hoping, this returns a usable object with a visible fallback name
 * — a rendered invoice missing its supplier is a bug you want to see, not one
 * that throws in a PDF worker at 2am.
 */
export function readSnapshot<T extends PartySnapshot>(value: Json | null, fallbackName: string): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as unknown as T
  }
  return { name: fallbackName } as T
}

export function formatPartyAddress(party: PartySnapshot): string[] {
  return [
    party.address_line1,
    party.address_line2,
    [party.city, party.pincode].filter(Boolean).join(' '),
    party.country,
  ]
    .map((line) => (line ?? '').trim())
    .filter((line) => line.length > 0)
}

export function formatInvoiceDate(value: string | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}
