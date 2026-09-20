import { describe, expect, it } from 'vitest'

import {
  businessSchema,
  clientSchema,
  invoiceSchema,
  lineItemSchema,
  numberingSchema,
  priceSchema,
  productSchema,
} from './validators'

describe('business profile', () => {
  const base = {
    legal_name: 'Umbrella Design Studio',
    country_code: 'US',
    currency: 'USD',
    address_line1: '4th Floor, Trade Centre',
    city: 'Austin',
  }

  it('accepts a minimal worldwide profile', () => {
    expect(businessSchema.safeParse(base).success).toBe(true)
  })

  it('uppercases country and currency', () => {
    const result = businessSchema.safeParse({ ...base, country_code: 'us', currency: 'usd' })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.country_code).toBe('US')
      expect(result.data.currency).toBe('USD')
    }
  })

  it('rejects an unknown country code', () => {
    const result = businessSchema.safeParse({ ...base, country_code: 'XX' })

    expect(result.success).toBe(false)
  })

  it('accepts an optional free-text tax ID', () => {
    expect(businessSchema.safeParse({ ...base, tax_id: 'US-EIN 12-3456789' }).success).toBe(true)
  })

  it('accepts a form that simply omits the optional fields', () => {
    expect(businessSchema.safeParse(base).success).toBe(true)
  })

  it('rejects null for an optional field, which is why callers must not pass it', () => {
    // formData.get() returns null for an absent field and Zod's .optional()
    // does not accept null. This test exists to pin that behaviour down: the
    // fix belongs in the caller (lib/actions/business.ts `field()`), not here.
    const result = businessSchema.safeParse({ ...base, email: null, phone: null })

    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path[0])).toEqual(
      expect.arrayContaining(['email', 'phone']),
    )
  })
})

describe('clients', () => {
  it('accepts a name-only client', () => {
    expect(clientSchema.safeParse({ name: 'Acme' }).success).toBe(true)
  })

  it('accepts a worldwide client with tax ID and country', () => {
    expect(
      clientSchema.safeParse({ name: 'Acme', tax_id: 'EU VAT', country_code: 'DE' }).success,
    ).toBe(true)
  })
})

describe('line items', () => {
  const base = {
    description: 'Brand identity design',
    quantity: 1,
    unit: 'NOS',
    rate: 50000,
    tax_rate: 18,
  }

  it('coerces numeric strings coming out of form inputs', () => {
    const result = lineItemSchema.parse({ ...base, quantity: '2.5', rate: '1200.50' })

    expect(result.quantity).toBe(2.5)
    expect(result.rate).toBe(1200.5)
  })

  it('rejects a zero quantity', () => {
    expect(lineItemSchema.safeParse({ ...base, quantity: 0 }).success).toBe(false)
  })

  it('accepts any tax rate from 0 to 100', () => {
    expect(lineItemSchema.safeParse({ ...base, tax_rate: 17 }).success).toBe(true)
    expect(lineItemSchema.safeParse({ ...base, tax_rate: 101 }).success).toBe(false)
  })
})

describe('invoices', () => {
  it('defaults currency to USD and needs no supply geography', () => {
    const result = invoiceSchema.safeParse({
      client: { name: 'Acme' },
      issue_date: '2026-09-17',
      items: [{ description: 'Design', quantity: 1, rate: 100 }],
    })

    expect(result.success).toBe(true)
    if (result.success) expect(result.data.currency).toBe('USD')
  })

  it('accepts a priced line that borrows from the catalog', () => {
    const result = invoiceSchema.safeParse({
      client: { name: 'Acme' },
      issue_date: '2026-09-17',
      items: [{ quantity: 2, price: 'price_AbC12345678901234567890' }],
    })

    expect(result.success).toBe(true)
  })

  it('rejects an ad-hoc line with no description and no price', () => {
    const result = invoiceSchema.safeParse({
      client: { name: 'Acme' },
      issue_date: '2026-09-17',
      items: [{ quantity: 1, rate: 100 }],
    })

    expect(result.success).toBe(false)
  })
})

describe('catalog', () => {
  it('accepts a minimal product', () => {
    expect(productSchema.safeParse({ name: 'Retainer' }).success).toBe(true)
  })

  it('accepts a one-off price', () => {
    expect(
      priceSchema.safeParse({ product: 'prod_xxx', unit_amount: 5000, currency: 'usd' }).success,
    ).toBe(true)
  })

  it('accepts a recurring price with an interval', () => {
    const result = priceSchema.safeParse({
      product: 'prod_xxx',
      unit_amount: 500,
      currency: 'USD',
      type: 'recurring',
      recurring_interval: 'month',
    })

    expect(result.success).toBe(true)
  })

  it('requires an interval on recurring prices and forbids it on one-off ones', () => {
    expect(
      priceSchema.safeParse({
        product: 'prod_xxx',
        unit_amount: 500,
        currency: 'USD',
        type: 'recurring',
      }).success,
    ).toBe(false)

    expect(
      priceSchema.safeParse({
        product: 'prod_xxx',
        unit_amount: 500,
        currency: 'USD',
        recurring_interval: 'month',
      }).success,
    ).toBe(false)
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

  it('allows up to 16 characters for locale-neutral PREFIX-0001 numbers', () => {
    expect(
      numberingSchema.safeParse({ invoice_prefix: 'ACME-2026', next_invoice_number: 1 }).success,
    ).toBe(true)
    expect(
      numberingSchema.safeParse({ invoice_prefix: 'ACME-2026-SUPERLONG', next_invoice_number: 1 })
        .success,
    ).toBe(false)
  })
})
