import { describe, expect, it } from 'vitest'

import { computeInvoice } from './tax'

function line(overrides = {}) {
  return {
    description: 'Consulting',
    quantity: 1,
    unit: 'NOS',
    rate: 1000,
    discountPercent: 0,
    taxRate: 18,
    ...overrides,
  }
}

describe('computeInvoice', () => {
  it('charges exclusive tax on the discounted value', () => {
    const result = computeInvoice({ lines: [line()] })

    expect(result.subtotalMinor).toBe(100000)
    expect(result.taxableTotalMinor).toBe(100000)
    expect(result.taxTotalMinor).toBe(18000)
    expect(result.totalMinor).toBe(118000)
  })

  it('discounts before tax', () => {
    const result = computeInvoice({ lines: [line({ discountPercent: 10 })] })

    expect(result.discountTotalMinor).toBe(10000)
    expect(result.taxableTotalMinor).toBe(90000)
    expect(result.taxTotalMinor).toBe(16200)
    expect(result.totalMinor).toBe(106200)
  })

  it('supports fractional quantities', () => {
    const result = computeInvoice({ lines: [line({ quantity: 2.5, rate: 100 })] })

    expect(result.subtotalMinor).toBe(25000)
  })

  it('rounds half-up on odd minor units', () => {
    // 45 minor at 100%? Use a case with a real half: 1 minor at 50% -> 0.5 -> 1.
    const result = computeInvoice({ lines: [line({ rate: 0.01, taxRate: 50 })] })

    expect(result.lines[0].taxMinor).toBe(1)
  })

  it('clamps rates into 0-100', () => {
    const result = computeInvoice({ lines: [line({ taxRate: 250, discountPercent: -5 })] })

    expect(result.lines[0].taxMinor).toBe(result.lines[0].taxableMinor)
    expect(result.lines[0].discountMinor).toBe(0)
  })

  it('writes the amount in words in the invoice currency', () => {
    const result = computeInvoice({ lines: [line()] }, 'EUR')

    expect(result.amountInWords).toContain('EUR')
  })
})

describe('buildTaxSummary', () => {
  it('groups lines by rate, sorted ascending', () => {
    const result = computeInvoice({
      lines: [line({ taxRate: 18 }), line({ taxRate: 5 }), line({ taxRate: 18, rate: 500 })],
    })

    expect(result.taxSummary.map((r) => r.taxRate)).toEqual([5, 18])
    expect(result.taxSummary[1].taxableMinor).toBe(150000)
  })
})

describe('zero-decimal currencies', () => {
  /** 10% of ¥333 is ¥33.3, and there is no such thing as 0.3 yen. */
  it('rounds every JPY amount to whole yen', () => {
    const result = computeInvoice({ lines: [line({ rate: 333, taxRate: 10 })] }, 'JPY')
    expect(result.taxTotalMinor).toBe(3300) // engine hundredths: ¥33
    expect(result.totalMinor).toBe(36600)
  })

  it('leaves two-decimal currencies exact to the cent', () => {
    const result = computeInvoice({ lines: [line({ rate: 333, taxRate: 10 })] }, 'USD')
    expect(result.taxTotalMinor).toBe(3330)
  })
})
