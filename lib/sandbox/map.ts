import type { GstTaxpayer } from '@/lib/sandbox/client'
import { isValidStateCode } from '@/lib/india'

/**
 * Turn a GST taxpayer record into the fields our onboarding form needs.
 *
 * Kept separate from the HTTP client so it can be unit tested against captured
 * payloads without any network or API keys.
 */

/** Constitution of business, normalised to the three types we ask about. */
export type BusinessType = 'sole_trader' | 'partnership' | 'limited_company' | 'other'

export interface PrefilledBusiness {
  gstin: string
  legal_name: string
  trade_name: string | null
  business_type: BusinessType
  /** The registered constitution string, kept verbatim for display. */
  constitution: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_code: string
  pincode: string | null
  gst_status: string | null
  registered_on: string | null
}

/**
 * The GST portal's constitution strings are free-ish text with real variation
 * ("Proprietorship", "Sole Proprietorship", "Private Limited Company",
 * "Public Limited Company", "Limited Liability Partnership"…), so this matches
 * on substrings rather than an exact set it would fall out of date with.
 *
 * LLP maps to partnership: it files as a partnership and, more to the point,
 * that's how its owners describe themselves.
 */
export function normaliseBusinessType(constitution: string | null | undefined): BusinessType {
  const value = (constitution ?? '').toLowerCase()
  if (!value) return 'other'

  if (value.includes('proprietor')) return 'sole_trader'
  if (value.includes('individual')) return 'sole_trader'
  if (value.includes('partnership') || value.includes('llp')) return 'partnership'
  if (value.includes('limited') || value.includes('private') || value.includes('public')) {
    return 'limited_company'
  }
  return 'other'
}

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  sole_trader: 'Sole trader',
  partnership: 'Partnership',
  limited_company: 'Limited company',
  other: 'Other',
}

/**
 * The state code comes from the GSTIN's first two digits, NOT from the address.
 *
 * `pradr.addr.stcd` is the state *name* ("Karnataka"), and matching names back
 * to codes is exactly the kind of string comparison that breaks on "Orissa" vs
 * "Odisha". The GSTIN prefix is authoritative and always present.
 */
function stateCodeFor(taxpayer: GstTaxpayer): string {
  const prefix = taxpayer.gstin?.slice(0, 2) ?? ''
  return isValidStateCode(prefix) ? prefix : ''
}

/**
 * First value that isn't null, undefined or whitespace.
 *
 * The GST portal populates missing fields with "" rather than omitting them, so
 * `a ?? b` picks the empty string and the fallback never runs.
 */
function firstNonBlank(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = (value ?? '').trim()
    if (trimmed) return trimmed
  }
  return null
}

/** Joins the GST portal's many address fragments into two usable lines. */
function addressLines(taxpayer: GstTaxpayer): { line1: string | null; line2: string | null } {
  const addr = taxpayer.pradr?.addr
  if (!addr) return { line1: null, line2: null }

  const parts = [addr.bno, addr.flno, addr.bnm, addr.st, addr.landMark]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)

  if (parts.length === 0) return { line1: null, line2: null }

  // Two lines rather than one long run-on: the first two fragments are usually
  // building and floor, the rest is street and landmark.
  const line1 = parts.slice(0, 2).join(', ') || null
  const line2 = parts.slice(2).join(', ') || null

  return { line1, line2 }
}

export function toPrefilledBusiness(taxpayer: GstTaxpayer): PrefilledBusiness {
  const addr = taxpayer.pradr?.addr
  const { line1, line2 } = addressLines(taxpayer)

  return {
    gstin: taxpayer.gstin,
    legal_name: (taxpayer.lgnm ?? '').trim(),
    trade_name: (taxpayer.tradeNam ?? '').trim() || null,
    business_type: normaliseBusinessType(taxpayer.ctb),
    constitution: (taxpayer.ctb ?? '').trim() || null,
    address_line1: line1,
    address_line2: line2,
    // `loc` is the town, `dst` the district. Prefer the town — it's what people
    // put on an invoice. `firstNonBlank` rather than `??` because the GST portal
    // returns "" for missing fields, which is not nullish and would win.
    city: firstNonBlank(addr?.loc, addr?.dst),
    state_code: stateCodeFor(taxpayer),
    pincode: (addr?.pncd ?? '').trim() || null,
    gst_status: (taxpayer.sts ?? '').trim() || null,
    registered_on: (taxpayer.rgdt ?? '').trim() || null,
  }
}

/**
 * True when the registration is not currently active — worth warning about,
 * since a cancelled GSTIN still returns full data and would otherwise sail
 * through onboarding onto real tax invoices.
 *
 * Accepts either shape: the raw taxpayer record uses `sts`, the mapped one
 * `gst_status`.
 */
export function isInactive(subject: GstTaxpayer | PrefilledBusiness): boolean {
  const status = 'gst_status' in subject ? subject.gst_status : subject.sts
  return (status ?? '').trim().toLowerCase() !== 'active'
}
