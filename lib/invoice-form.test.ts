import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BusinessRow } from './database.types'
import { computeInvoice } from './gst'
import {
  defaultInvoiceValues,
  emptyLineItem,
  num,
  toGstInput,
  toSavePayload,
  type InvoiceFormValues,
} from './invoice-form'
import { toRupees } from './money'

// Only the fields the form helpers read; the rest of the row is irrelevant here.
const business = {
  state_code: '27',
  is_gst_registered: true,
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
    expect(values.currency).toBe('INR')
    expect(values.client.country).toBe('India')
  })

  it('defaults place of supply to the supplier state, so a local client is right with no input', () => {
    const values = defaultInvoiceValues(business)
    expect(values.place_of_supply_state_code).toBe('27')
    expect(values.client.state_code).toBe('27')
  })

  it('carries the business default notes and terms', () => {
    const values = defaultInvoiceValues(business)
    expect(values.notes).toBe('Thank you for your business')
    expect(values.terms).toBe('Payment due in 15 days')
  })

  it('works before onboarding, with no business yet', () => {
    const values = defaultInvoiceValues(null)
    expect(values.place_of_supply_state_code).toBe('')
    expect(values.notes).toBe('')
  })

  it('hands out a fresh line item each time, not a shared object', () => {
    const a = emptyLineItem()
    const b = emptyLineItem()
    a.description = 'changed'
    expect(b.description).toBe('')
  })
})

describe('toGstInput — the live preview path', () => {
  it('coerces every numeric string for the tax engine', () => {
    const input = toGstInput(filledForm(), business)
    expect(input.lines[0]).toMatchObject({
      quantity: 1,
      rate: 1000,
      discountPercent: 0,
      gstRate: 18,
      cessRate: 0,
    })
  })

  it('omits a blank HSN/SAC rather than sending an empty string', () => {
    expect(toGstInput(filledForm(), business).lines[0].hsnSac).toBeUndefined()
  })

  it('treats a missing business as unregistered with no state', () => {
    const input = toGstInput(filledForm(), null)
    expect(input.supplierIsGstRegistered).toBe(false)
    expect(input.supplierStateCode).toBe('')
  })

  it('produces a preview total that matches the tax engine', () => {
    const result = computeInvoice(toGstInput(filledForm(), business))
    expect(toRupees(result.cgstTotalPaise)).toBe(90)
    expect(toRupees(result.sgstTotalPaise)).toBe(90)
    expect(toRupees(result.totalPaise)).toBe(1180)
  })

  it('does not crash the preview while a rate is still being typed', () => {
    const form = filledForm({ items: [{ ...emptyLineItem(), rate: '' }] })
    expect(computeInvoice(toGstInput(form, business)).totalPaise).toBe(0)
  })
})

describe('toSavePayload — the server action path', () => {
  it('sends numbers, not strings', () => {
    const payload = toSavePayload(filledForm())
    expect(payload.items[0].rate).toBe(1000)
    expect(payload.items[0].gst_rate).toBe(18)
  })

  it('keeps a blank HSN/SAC as-is for the server to validate', () => {
    expect(toSavePayload(filledForm()).items[0].hsn_sac).toBe('')
  })

  it('copies the client instead of sharing the form object', () => {
    const form = filledForm()
    const payload = toSavePayload(form)
    payload.client.name = 'mutated'
    expect(form.client.name).toBe('')
  })
})
