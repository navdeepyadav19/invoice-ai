import { describe, expect, it } from 'vitest'

import { normaliseDraft, stateCodeFromName } from './normalise'
import type { AiInvoiceDraft } from './invoice-schema'

function draft(overrides: Partial<AiInvoiceDraft> = {}): AiInvoiceDraft {
  return {
    client_name: 'Sharma Traders',
    client_gstin: null,
    client_city: null,
    client_email: null,
    place_of_supply_state_name: null,
    due_in_days: null,
    notes: null,
    amount_is_tax_inclusive: false,
    items: [
      {
        description: 'Consulting',
        quantity: 1,
        unit: 'NOS',
        rate: 10000,
        gst_rate: 18,
        hsn_sac: null,
      },
    ],
    ...overrides,
  }
}

describe('tax-inclusive amounts', () => {
  it('backs GST out of an inclusive figure', () => {
    // "₹11,800 all in" at 18% is a ₹10,000 line.
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
        items: [{ ...draft().items[0], rate: 5000, gst_rate: 0 }],
      }),
    )

    expect(result.items[0].rate).toBe(5000)
  })

  it('rounds to paise rather than leaving a float tail', () => {
    // 1000 / 1.18 = 847.4576271186441…
    const result = normaliseDraft(
      draft({ amount_is_tax_inclusive: true, items: [{ ...draft().items[0], rate: 1000 }] }),
    )

    expect(result.items[0].rate).toBe(847.46)
  })
})

describe('GST slabs', () => {
  it('keeps a real slab', () => {
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], gst_rate: 12 }] })).items[0].gst_rate).toBe(12)
  })

  it('snaps an invented rate to the nearest real slab', () => {
    // The model occasionally returns 20 or 17; neither is a GST slab.
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], gst_rate: 17 }] })).items[0].gst_rate).toBe(18)
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], gst_rate: 20 }] })).items[0].gst_rate).toBe(18)
  })

  it('rounds a tie upward rather than down', () => {
    // 4 is equidistant from the 3% jewellery slab and the 5% slab. Rounding up
    // is deliberate: under-charging GST leaves the merchant owing the shortfall,
    // while over-charging is on the face of the invoice and gets queried.
    expect(normaliseDraft(draft({ items: [{ ...draft().items[0], gst_rate: 4 }] })).items[0].gst_rate).toBe(5)
  })
})

describe('units', () => {
  it('accepts a real UQC', () => {
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

describe('state resolution', () => {
  it('resolves an exact state name', () => {
    expect(stateCodeFromName('Karnataka')).toBe('29')
    expect(stateCodeFromName('maharashtra')).toBe('27')
  })

  it('resolves a partial match', () => {
    expect(stateCodeFromName('Tamil Nadu state')).toBe('33')
  })

  it('returns null rather than guessing', () => {
    // A wrong state code silently flips CGST/SGST to IGST, so "no answer" is
    // the only safe answer for something unrecognised.
    expect(stateCodeFromName('Atlantis')).toBeNull()
    expect(stateCodeFromName('')).toBeNull()
    expect(stateCodeFromName(null)).toBeNull()
  })

  it('is wired into the draft', () => {
    const result = normaliseDraft(draft({ place_of_supply_state_name: 'Karnataka' }))
    expect(result.place_of_supply_state_code).toBe('29')
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

  it('uppercases a spoken GSTIN', () => {
    expect(normaliseDraft(draft({ client_gstin: '27aapfu0939f1zv' })).client_gstin).toBe(
      '27AAPFU0939F1ZV',
    )
  })

  it('ignores a nonsensical due-in-days', () => {
    expect(normaliseDraft(draft({ due_in_days: -5 })).due_in_days).toBeNull()
    expect(normaliseDraft(draft({ due_in_days: 30 })).due_in_days).toBe(30)
  })
})
