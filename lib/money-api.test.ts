import { describe, expect, it } from 'vitest'

import {
  invoiceTotalsToMinor,
  lineItemAmountsToMinor,
  paiseToStored,
  storedToMinor,
  wireMinorToMajor,
} from './money-api'
import { isServiceError } from './services/errors'

/**
 * The bug this file exists to prevent: postgrest returns numeric(14,2) as a
 * *string*, so `row.total * 100` is NaN and `row.total === 25000` is false,
 * both of which typecheck happily if the row type says `number`.
 */
describe('stored amounts', () => {
  it('converts a numeric string from postgrest', () => {
    expect(storedToMinor('25000.00', 'USD')).toBe(2500000)
    expect(storedToMinor('0.01', 'USD')).toBe(1)
  })

  it('converts a number just the same', () => {
    expect(storedToMinor(25000, 'USD')).toBe(2500000)
  })

  it('round-trips through the database representation', () => {
    for (const cents of [0, 1, 99, 100, 2500000, 999999999]) {
      expect(storedToMinor(paiseToStored(cents), 'USD')).toBe(cents)
    }
  })

  /**
   * 0.1 + 0.2 !== 0.3 is exactly why the wire contract is integers. If this
   * ever returns 1999.9999999999998 cents, the contract has started carrying
   * floats and totals will disagree with themselves.
   */
  it('does not accumulate floating point error', () => {
    expect(storedToMinor('19.99', 'USD')).toBe(1999)
    expect(storedToMinor('0.30', 'USD')).toBe(30)
    expect(storedToMinor('1234567.89', 'USD')).toBe(123456789)
  })

  it('handles a negative round-off', () => {
    expect(storedToMinor('-0.40', 'USD')).toBe(-40)
  })
})

/** The yen has no minor unit, so ¥5,000 is 5000 on the wire, not 500000. */
describe('per-currency minor units', () => {
  it('JPY: ¥5000 is stored as 5000.00 and sent as 5000', () => {
    expect(wireMinorToMajor(5000, 'JPY', 'unit_amount')).toBe(5000)
    expect(storedToMinor('5000.00', 'JPY')).toBe(5000)
  })

  it('USD: 2500 on the wire is $25.00', () => {
    expect(wireMinorToMajor(2500, 'USD', 'unit_amount')).toBe(25)
    expect(storedToMinor('25.00', 'USD')).toBe(2500)
  })

  it('KWD: three decimals, so 1.50 KWD is 1500 fils', () => {
    expect(storedToMinor('1.50', 'KWD')).toBe(1500)
    expect(wireMinorToMajor(1500, 'KWD', 'unit_amount')).toBe(1.5)
  })

  it('rejects a three-decimal amount numeric(14,2) cannot hold', () => {
    try {
      wireMinorToMajor(1234, 'KWD', 'items.0.unit_amount')
      expect.unreachable()
    } catch (error) {
      expect(isServiceError(error) && error.code).toBe('validation')
      expect(isServiceError(error) && error.details?.[0]?.path).toBe('items.0.unit_amount')
    }
  })
})

describe('invoice totals', () => {
  it('converts every money column to minor units', () => {
    const result = invoiceTotalsToMinor({
      currency: 'USD',
      subtotal: '25000.00',
      discount_total: '0.00',
      taxable_total: '25000.00',
      tax_total: '4500.00',
      round_off: '0.00',
      total: '29500.00',
    })

    expect(result).toEqual({
      subtotal: 2500000,
      discount_total: 0,
      taxable_total: 2500000,
      tax_total: 450000,
      round_off: 0,
      total: 2950000,
    })
  })

  it('uses the invoice currency', () => {
    const result = invoiceTotalsToMinor({
      currency: 'JPY',
      subtotal: '5000.00',
      discount_total: '0.00',
      taxable_total: '5000.00',
      tax_total: '500.00',
      round_off: '0.00',
      total: '5500.00',
    })
    expect(result.total).toBe(5500)
    expect(result.tax_total).toBe(500)
  })

  it('reads legacy CGST/SGST/IGST columns when tax_total is absent', () => {
    const result = invoiceTotalsToMinor({
      currency: 'INR',
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

    expect(result.tax_total).toBe(450000)
  })

  it('keeps an 18% tax adding up', () => {
    const result = invoiceTotalsToMinor({
      currency: 'USD',
      subtotal: '25000.00',
      discount_total: '0.00',
      taxable_total: '25000.00',
      tax_total: '4500.00',
      round_off: '0.00',
      total: '29500.00',
    })

    expect(result.taxable_total + result.tax_total + result.round_off).toBe(result.total)
  })
})

describe('line items', () => {
  it('converts the rate and every amount', () => {
    const result = lineItemAmountsToMinor(
      { rate: '1000.00', taxable_value: '1000.00', tax_amount: '180.00', line_total: '1180.00' },
      'USD',
    )

    expect(result).toEqual({ unit_amount: 100000, taxable_value: 100000, tax_amount: 18000, line_total: 118000 })
  })

  it('JPY lines are whole yen', () => {
    const result = lineItemAmountsToMinor(
      { rate: '5000.00', taxable_value: '5000.00', tax_amount: '0.00', line_total: '5000.00' },
      'JPY',
    )
    expect(result.unit_amount).toBe(5000)
    expect(result.line_total).toBe(5000)
  })
})
