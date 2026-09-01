import { describe, expect, it } from 'vitest'

import {
  businessSchema,
  hasValidGstinChecksum,
  lineItemSchema,
  numberingSchema,
  stateCodeFromGstin,
} from './validators'

/**
 * The reference GSTIN from the GSTN's own documentation. Its check character is
 * the one published test vector for the checksum algorithm, so every mutation
 * test below is measured against it.
 */
const VALID_GSTIN = '27AAPFU0939F1ZV'

describe('GSTIN checksum', () => {
  it('accepts the reference GSTIN', () => {
    expect(hasValidGstinChecksum(VALID_GSTIN)).toBe(true)
  })

  it('rejects a transposition that the regex alone would let through', () => {
    // Swapping two digits keeps the shape valid but breaks the weighted sum —
    // exactly the typo a checksum exists to catch.
    const transposed = '27AAPFU9039F1ZV'
    expect(transposed).toMatch(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/)
    expect(hasValidGstinChecksum(transposed)).toBe(false)
  })

  it('rejects a wrong check character', () => {
    expect(hasValidGstinChecksum('27AAPFU0939F1ZX')).toBe(false)
  })

  it('rejects anything malformed', () => {
    expect(hasValidGstinChecksum('')).toBe(false)
    expect(hasValidGstinChecksum('27AAPFU0939F1Z')).toBe(false)
    expect(hasValidGstinChecksum('27aapfu0939f1zv')).toBe(false)
  })

  it('reads the registration state off the front', () => {
    expect(stateCodeFromGstin(VALID_GSTIN)).toBe('27')
    expect(stateCodeFromGstin('25AAPFU0939F1ZV')).toBeNull() // 25 was merged into 26
  })
})

describe('business profile', () => {
  const base = {
    legal_name: 'Umbrella Design Studio',
    is_gst_registered: true,
    gstin: VALID_GSTIN,
    address_line1: '4th Floor, Trade Centre',
    city: 'Mumbai',
    state_code: '27',
    country: 'India',
  }

  it('accepts a GSTIN whose state matches the selected state', () => {
    expect(businessSchema.safeParse(base).success).toBe(true)
  })

  it('rejects a GSTIN registered in a different state than the one selected', () => {
    const result = businessSchema.safeParse({ ...base, state_code: '29' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['gstin'])
    expect(result.error?.issues[0].message).toContain('Maharashtra')
  })

  it('requires a GSTIN once you claim registration', () => {
    const result = businessSchema.safeParse({ ...base, gstin: '' })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['gstin'])
  })

  it('lets an unregistered business through without a GSTIN', () => {
    const result = businessSchema.safeParse({ ...base, is_gst_registered: false, gstin: '' })

    expect(result.success).toBe(true)
  })

  it('accepts a form that simply omits the optional fields', () => {
    // A form that doesn't render `email` or `phone` must still validate. This is
    // the shape the onboarding manual form posts now that contact details moved
    // to settings.
    expect(businessSchema.safeParse(base).success).toBe(true)
  })

  it('rejects null for an optional field, which is why callers must not pass it', () => {
    // formData.get() returns null for an absent field and Zod's .optional()
    // does not accept null. This test exists to pin that behaviour down: the
    // fix belongs in the caller (lib/actions/business.ts `field()`), not here,
    // because loosening the schema to .nullish() would hide genuinely missing
    // required data too.
    const result = businessSchema.safeParse({ ...base, email: null, phone: null })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['email', 'phone']),
    )
  })
})

describe('line items', () => {
  const base = {
    description: 'Brand identity design',
    quantity: 1,
    unit: 'NOS',
    rate: 50000,
    gst_rate: 18,
  }

  it('coerces numeric strings coming out of form inputs', () => {
    const result = lineItemSchema.parse({ ...base, quantity: '2.5', rate: '1200.50' })

    expect(result.quantity).toBe(2.5)
    expect(result.rate).toBe(1200.5)
  })

  it('rejects a zero quantity', () => {
    expect(lineItemSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false)
  })

  it('rejects a GST rate that is not a real slab', () => {
    expect(lineItemSchema.safeParse({ ...base, gst_rate: 17 }).success).toBe(false)
  })
})

describe('invoice numbering settings', () => {
  it('uppercases and accepts a normal prefix', () => {
    expect(numberingSchema.parse({ invoice_prefix: 'inv', next_invoice_number: 1 })).toEqual({
      invoice_prefix: 'INV',
      next_invoice_number: 1,
    })
  })

  it('rejects a prefix with spaces or punctuation that would break the number', () => {
    expect(numberingSchema.safeParse({ invoice_prefix: 'IN V', next_invoice_number: 1 }).success).toBe(false)
    expect(numberingSchema.safeParse({ invoice_prefix: 'IN#V', next_invoice_number: 1 }).success).toBe(false)
  })
})
