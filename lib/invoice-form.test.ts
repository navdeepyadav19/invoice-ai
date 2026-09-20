import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BusinessRow } from './database.types'
import { computeInvoice } from './tax'
import {
  defaultInvoiceValues,
  emptyLineItem,
  num,
  toTaxInput,
  toSavePayload,
  type InvoiceFormValues,
} from './invoice-form'
import { toMajor } from './money'

// Only the fields the form helpers read; the rest of the row is irrelevant here.
const business = {
  country_code: 'US',
  currency: 'USD',
  default_notes: 'Thank you for your business',
  default_terms: 'Payment due in 15 days',
} as BusinessRow

function filledForm(overrides: Partial<InvoiceFormValues> = {}): InvoiceFormValues {
  return {
    ...defaultInvoiceValues(business),
    items: [{ ...emptyLineItem(), description: 'Consulting', rate: '1000' }],
    ...overrides,
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('num — reading half-typed inputs', () => {
  it('treats empty, partial and junk input as zero instead of NaN', () => {
    expect(num('')).toBe(0)
    expect(num('abc')).toBe(0)
    expect(num(undefined)).toBe(0)
  })

  it('accepts what a user has typed so far', () => {
    expect(num('1.')).toBe(1)
    expect(num(' 12.5 ')).toBe(12.5)
    expect(num('12abc')).toBe(12)
  })

  it('passes finite numbers through and zeroes non-finite ones', () => {
    expect(num(7)).toBe(7)
    expect(num(Number.NaN)).toBe(0)
    expect(num(Number.POSITIVE_INFINITY)).toBe(0)
  })
})

describe('defaultInvoiceValues', () => {
  it('starts with one empty line and today as the issue date', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-14T10:00:00Z'))

    const values = defaultInvoiceValues(null)
    expect(values.issue_date).toBe('2026-09-14')
    expect(values.items).toHaveLength(1)
    expect(values.currency).toBe('USD')
    expect(values.client.country_code).toBe('US')
  })

  it('inherits the business currency and country', () => {
    const values = defaultInvoiceValues({ ...business, country_code: 'DE', currency: 'EUR' } as BusinessRow)
    expect(values.currency).toBe('EUR')
    expect(values.client.country_code).toBe('DE')
  })

  it('carries the business default notes and terms', () => {
    const values = defaultInvoiceValues(business)
    expect(values.notes).toBe('Thank you for your business')
    expect(values.terms).toBe('Payment due in 15 days')
  })

  it('hands out a fresh line item each time, not a shared object', () => {
    const a = emptyLineItem()
    const b = emptyLineItem()
    a.description = 'changed'
    expect(b.description).toBe('')
  })
})

describe('toTaxInput — the live preview path', () => {
  it('coerces every numeric string for the tax engine', () => {
    const input = toTaxInput(filledForm())
    expect(input.lines[0]).toMatchObject({
      quantity: 1,
      rate: 1000,
      discountPercent: 0,
      taxRate: 0,
    })
  })

  it('produces a preview total that matches the tax engine', () => {
    const form = filledForm({
      items: [{ ...emptyLineItem(18), description: 'Consulting', rate: '1000' }],
    })
    const result = computeInvoice(toTaxInput(form))
    expect(toMajor(result.taxTotalMinor)).toBe(180)
    expect(toMajor(result.totalMinor)).toBe(1180)
  })

  it('does not crash the preview while a rate is still being typed', () => {
    const form = filledForm({ items: [{ ...emptyLineItem(), rate: '' }] })
    expect(computeInvoice(toTaxInput(form)).totalMinor).toBe(0)
  })
})

describe('toSavePayload — the server action path', () => {
  it('sends numbers, not strings', () => {
    const payload = toSavePayload(filledForm())
    expect(payload.items[0].rate).toBe(1000)
    expect(payload.items[0].tax_rate).toBe(0)
  })

  it('copies the client instead of sharing the form object', () => {
    const form = filledForm()
    const payload = toSavePayload(form)
    payload.client.name = 'mutated'
    expect(form.client.name).toBe('')
  })
})
