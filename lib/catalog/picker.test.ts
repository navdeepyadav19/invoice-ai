import { describe, expect, it } from 'vitest'

import {
  clientDiffers,
  customerLinkForSave,
  customerToFormClient,
  formatPriceLabel,
  isBlankLine,
  isCurrencyMismatch,
  isSavedCustomerLink,
  priceToLineItem,
  sanitizeSearchTerm,
  type CustomerOption,
  type PriceOption,
} from './picker'
import { toSavePayload, defaultInvoiceValues } from '@/lib/invoice-form'

function price(overrides: Partial<PriceOption> = {}): PriceOption {
  return {
    id: 'price_AbC12345678901234567890',
    productName: 'Design retainer',
    nickname: null,
    unitAmount: 2500,
    currency: 'INR',
    taxRate: 18,
    type: 'recurring',
    interval: 'month',
    intervalCount: 1,
    ...overrides,
  }
}

function customer(overrides: Partial<CustomerOption> = {}): CustomerOption {
  return {
    id: 'cus_AbC12345678901234567890',
    name: 'Acme Industries',
    email: 'ap@acme.test',
    phone: null,
    tax_id: 'GB123',
    address_line1: '1 Main St',
    address_line2: null,
    city: 'London',
    region: null,
    postal_code: 'EC1',
    country_code: 'GB',
    ...overrides,
  }
}

describe('formatPriceLabel', () => {
  it('formats a monthly INR price without decimals', () => {
    expect(formatPriceLabel(price())).toBe('₹2,500 / month')
  })

  it('keeps cents when the amount is fractional', () => {
    expect(formatPriceLabel(price({ currency: 'USD', unitAmount: 99.5, type: 'one_time', interval: null }))).toBe(
      '$99.50',
    )
  })

  it('says "every N intervals" for multi-interval prices', () => {
    expect(formatPriceLabel(price({ currency: 'USD', unitAmount: 300, intervalCount: 3 }))).toBe(
      '$300 every 3 months',
    )
  })

  it('does not throw on an unknown currency code', () => {
    expect(formatPriceLabel(price({ currency: 'ZZ', type: 'one_time', interval: null }))).toContain('2500')
  })
})

describe('isCurrencyMismatch', () => {
  it('compares case- and whitespace-insensitively', () => {
    expect(isCurrencyMismatch('usd', ' USD ')).toBe(false)
    expect(isCurrencyMismatch('EUR', 'USD')).toBe(true)
  })

  it('treats a missing price currency as no mismatch', () => {
    expect(isCurrencyMismatch(undefined, 'USD')).toBe(false)
  })
})

describe('priceToLineItem', () => {
  it('prefills description, rate and tax and keeps the price reference', () => {
    expect(priceToLineItem(price({ nickname: 'Monthly' }))).toMatchObject({
      description: 'Design retainer — Monthly',
      quantity: '1',
      rate: '2500',
      tax_rate: '18',
      price: 'price_AbC12345678901234567890',
      price_currency: 'INR',
      price_label: '₹2,500 / month',
    })
  })

  it('round-trips through the save payload as a priced line', () => {
    const values = { ...defaultInvoiceValues(null), items: [priceToLineItem(price())] }
    const [line] = toSavePayload(values).items
    expect(line).toMatchObject({ price: 'price_AbC12345678901234567890', rate: 2500, tax_rate: 18 })
  })

  it('omits price on ad-hoc lines', () => {
    const payload = toSavePayload(defaultInvoiceValues(null))
    expect(payload.items[0]).not.toHaveProperty('price')
  })
})

describe('isBlankLine', () => {
  it('is true only for an untouched starter row', () => {
    expect(isBlankLine({ description: ' ', rate: '' })).toBe(true)
    expect(isBlankLine({ description: 'x', rate: '' })).toBe(false)
    expect(isBlankLine({ description: '', rate: '10' })).toBe(false)
    expect(isBlankLine({ description: '', rate: '', price: 'price_x' })).toBe(false)
  })
})

describe('customer linking', () => {
  it('fills every Bill-to field, falling back to the business country', () => {
    const filled = customerToFormClient(customer({ country_code: null, city: null }), 'IN')
    expect(filled).toMatchObject({ name: 'Acme Industries', city: '', country_code: 'IN', tax_id: 'GB123' })
  })

  it('detects edits after a pick but ignores trailing whitespace and country case', () => {
    const snapshot = customerToFormClient(customer(), 'IN')
    expect(clientDiffers({ ...snapshot, name: 'Acme Industries ' }, snapshot)).toBe(false)
    expect(clientDiffers({ ...snapshot, country_code: 'gb' }, snapshot)).toBe(false)
    expect(clientDiffers({ ...snapshot, email: 'other@acme.test' }, snapshot)).toBe(true)
  })

  it('decides the save link: link, detach, or legacy', () => {
    expect(customerLinkForSave('cus_a', null)).toBe('cus_a')
    expect(customerLinkForSave('cus_b', 'cus_a')).toBe('cus_b')
    expect(customerLinkForSave(null, 'cus_a')).toBeNull()
    expect(customerLinkForSave(null, null)).toBeUndefined()
  })

  it('treats a row created alongside the draft as the draft’s own', () => {
    expect(
      isSavedCustomerLink({
        clientCreatedAt: '2026-01-01T10:00:00.000Z',
        invoiceCreatedAt: '2026-01-01T10:00:00.150Z',
        otherInvoiceCount: 0,
      }),
    ).toBe(false)
  })

  it('treats an older or shared row as a saved customer', () => {
    expect(
      isSavedCustomerLink({
        clientCreatedAt: '2026-01-01T09:00:00Z',
        invoiceCreatedAt: '2026-01-01T10:00:00Z',
        otherInvoiceCount: 0,
      }),
    ).toBe(true)
    expect(
      isSavedCustomerLink({
        clientCreatedAt: '2026-01-01T10:00:00Z',
        invoiceCreatedAt: '2026-01-01T10:00:00Z',
        otherInvoiceCount: 2,
      }),
    ).toBe(true)
  })
})

describe('sanitizeSearchTerm', () => {
  it('escapes wildcards and strips filter syntax', () => {
    expect(sanitizeSearchTerm('  10%_off, (pro)  ')).toBe('10\\%\\_off pro')
  })

  it('caps length', () => {
    expect(sanitizeSearchTerm('a'.repeat(500))).toHaveLength(100)
  })
})
