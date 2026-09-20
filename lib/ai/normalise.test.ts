import { describe, expect, it } from 'vitest'

import { normaliseDraft } from './normalise'
import type { AiInvoiceDraft } from './invoice-schema'

function draft(overrides: Partial<AiInvoiceDraft> = {}): AiInvoiceDraft {
  return {
    client_name: 'Acme Traders',
    client_city: null,
    client_email: null,
    due_in_days: null,
    notes: null,
    amount_is_tax_inclusive: false,
    items: [
      {
        description: 'Consulting',
        quantity: 1,
        unit: 'NOS',
        rate: 10000,
        tax_rate: 18,
      },
    ],
    ...overrides,
  }
}

describe('tax-inclusive amounts', () => {
  it('backs tax out of an inclusive figure', () => {
    // "$11,800 all in" at 18% is a $10,000 line.
    const result = normaliseDraft(
      draft({ amount_is_tax_inclusive: true, items: [{ ...draft().items[0], rate: 11800 }] }),
    )

    expect(result.items[0].rate).toBe(10000)
  })

  it('leaves an exclusive figure alone', () => {
    expect(normaliseDraft(draft()).items[0].rate).toBe(10000)
  })

  it('does not divide by zero on a zero-rated inclusive amount', () => {
    const result = normaliseDraft(
      draft({
        amount_is_tax_inclusive: true,
        items: [{ ...draft().items[0], rate: 5000, tax_rate: 0 }],
      }),
    )

    expect(result.items[0].rate).toBe(5000)
  })

  it('rounds to cents rather than leaving a float tail', () => {
    // 1000 / 1.18 = 847.4576271186441…
    const result = normaliseDraft(
      draft({ amount_is_tax_inclusive: true, items: [{ ...draft().items[0], rate: 1000 }] }),
    )

    expect(result.items[0].rate).toBe(847.46)
  })
})

describe('tax rates', () => {
  it('keeps an explicit rate', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], tax_rate: 12 }] })).items[0].tax_rate).toBe(12)
  })

  it('falls back to the business default when the model returns null', () => {
    expect(
      normaliseDraft(draft({ items: [{ ...draft().items[0], tax_rate: null }] }), 20).items[0].tax_rate,
    ).toBe(20)
  })

  it('clamps a nonsensical rate into range', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], tax_rate: 250 }] })).items[0].tax_rate).toBe(100)
  })
})

describe('units', () => {
  it('accepts a real unit', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], unit: 'HRS' }] })).items[0].unit).toBe('HRS')
  })

  it('maps the spoken forms people actually use', () => {
    const unitFor = (unit: string) =>
      normaliseDraft(draft({ items: [{ ...draft().items[0], unit }] })).items[0].unit

    expect(unitFor('hours')).toBe('HRS')
    expect(unitFor('days')).toBe('DAY')
    expect(unitFor('pieces')).toBe('PCS')
    expect(unitFor('kg')).toBe('KGS')
    expect(unitFor('each')).toBe('NOS')
  })

  it('falls back to NOS for anything unrecognised', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], unit: 'sprockets' }] })).items[0].unit).toBe('NOS')
  })
})

describe('defensive handling', () => {
  it('treats a zero or negative quantity as one', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], quantity: 0 }] })).items[0].quantity).toBe(1)
  })

  it('turns blank strings into nulls', () => {
    const result = normaliseDraft(draft({ client_name: '   ', client_city: '' }))

    expect(result.client_name).toBeNull()
    expect(result.client_city).toBeNull()
  })

  it('ignores a nonsensical due-in-days', () => {
    expect(normaliseDraft(draft({ due_in_days: -5 })).due_in_days).toBeNull()
    expect(normaliseDraft(draft({ due_in_days: 30 })).due_in_days).toBe(30)
  })
})
