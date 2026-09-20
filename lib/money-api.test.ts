import { describe, expect, it } from 'vitest'

import { invoiceTotalsToPaise, lineItemAmountsToPaise, paiseToStored, storedToPaise } from './money-api'

/**
 * The bug this file exists to prevent: postgrest returns numeric(14,2) as a
 * *string*, so `row.total * 100` is NaN and `row.total === 25000` is false,
 * both of which typecheck happily if the row type says `number`.
 */
describe('stored amounts', () => {
  it('converts a numeric string from postgrest', () => {
    expect(storedToPaise('25000.00')).toBe(2500000)
    expect(storedToPaise('0.01')).toBe(1)
  })

  it('converts a number just the same', () => {
    expect(storedToPaise(25000)).toBe(2500000)
  })

  it('round-trips through the database representation', () => {
    for (const paise of [0, 1, 99, 100, 2500000, 999999999]) {
      expect(storedToPaise(paiseToStored(paise))).toBe(paise)
    }
  })

  /**
   * 0.1 + 0.2 !== 0.3 is exactly why the wire contract is integers. If this
   * ever returns 1999.9999999999998 paise, the contract has started carrying
   * floats and totals will disagree with themselves.
   */
  it('does not accumulate floating point error', () => {
    expect(storedToPaise('19.99')).toBe(1999)
    expect(storedToPaise('0.30')).toBe(30)
    expect(storedToPaise('1234567.89')).toBe(123456789)
  })
})

describe('invoice totals', () => {
  it('renames every money column to a _paise integer', () => {
    const result = invoiceTotalsToPaise({
      subtotal: '25000.00',
      discount_total: '0.00',
      taxable_total: '25000.00',
      tax_total: '4500.00',
      round_off: '0.00',
      total: '29500.00',
    })

    expect(result).toEqual({
      subtotal_paise: 2500000,
      discount_total_paise: 0,
      taxable_total_paise: 2500000,
      tax_total_paise: 450000,
      round_off_paise: 0,
      total_paise: 2950000,
    })

    // Every key on the wire ends in _paise. A field that slipped through in
    // decimals would be indistinguishable to an integrator until a reconciliation.
    expect(Object.keys(result).every((key) => key.endsWith('_paise'))).toBe(true)
  })

  it('reads legacy CGST/SGST/IGST columns when tax_total is absent', () => {
    const result = invoiceTotalsToPaise({
      subtotal: '25000.00',
      discount_total: '0.00',
      taxable_total: '25000.00',
      cgst_total: '2250.00',
      sgst_total: '2250.00',
      igst_total: '0.00',
      cess_total: '0.00',
      round_off: '0.00',
      total: '29500.00',
    })

    expect(result.tax_total_paise).toBe(450000)
  })

  it('keeps an 18% tax adding up', () => {
    const result = invoiceTotalsToPaise({
      subtotal: '25000.00',
      discount_total: '0.00',
      taxable_total: '25000.00',
      tax_total: '4500.00',
      round_off: '0.00',
      total: '29500.00',
    })

    expect(result.taxable_total_paise + result.tax_total_paise + result.round_off_paise).toBe(
      result.total_paise,
    )
  })

  it('handles a negative round-off', () => {
    expect(storedToPaise('-0.40')).toBe(-40)
  })
})

describe('line items', () => {
  it('maps tax_amount to tax_amount_paise', () => {
    const result = lineItemAmountsToPaise({
      taxable_value: '1000.00',
      tax_amount: '180.00',
      line_total: '1180.00',
    })

    expect(result).toEqual({
      taxable_value_paise: 100000,
      tax_amount_paise: 18000,
      line_total_paise: 118000,
    })
  })
})
