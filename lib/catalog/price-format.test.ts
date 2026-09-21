import { describe, expect, it } from 'vitest'

import {
  currencyDecimals,
  describeBilling,
  formatAmount,
  formatPriceLabel,
  parseMajorAmount,
  summarizePrices,
} from './price-format'

const monthly = { type: 'recurring' as const, recurring_interval: 'month' as const, interval_count: 1 }
const oneOff = { type: 'one_time' as const, recurring_interval: null, interval_count: 1 }

describe('price formatting', () => {
  it('knows zero-decimal currencies', () => {
    expect(currencyDecimals('USD')).toBe(2)
    expect(currencyDecimals('JPY')).toBe(0)
  })

  it('formats with the currency’s own decimals', () => {
    expect(formatAmount(5000, 'JPY')).toBe('¥5,000')
    expect(formatAmount('30.00', 'USD')).toBe('$30.00')
    expect(formatAmount(2500, 'INR', { compact: true })).toBe('₹2,500')
    expect(formatAmount(49.5, 'USD', { compact: true })).toBe('$49.50')
  })

  it('labels recurring and one-off prices', () => {
    expect(formatPriceLabel({ ...monthly, unit_amount: 2500, currency: 'INR' })).toBe('₹2,500/mo')
    expect(formatPriceLabel({ ...oneOff, unit_amount: 5000, currency: 'JPY' })).toBe('¥5,000')
    expect(
      formatPriceLabel({ ...monthly, interval_count: 3, unit_amount: 30, currency: 'USD' }),
    ).toBe('$30 every 3 months')
    expect(describeBilling({ ...monthly, interval_count: 3 })).toBe('Every 3 months')
    expect(describeBilling(oneOff)).toBe('One-off')
  })

  it('summarises several prices', () => {
    const prices = [
      { ...monthly, unit_amount: 2500, currency: 'INR' },
      { ...monthly, unit_amount: 30, currency: 'USD' },
      { ...oneOff, unit_amount: 5000, currency: 'JPY' },
    ]
    expect(summarizePrices(prices.slice(0, 2))).toBe('₹2,500/mo · $30/mo')
    expect(summarizePrices(prices)).toBe('₹2,500/mo · $30/mo · +1 more')
    expect(summarizePrices([])).toBe('')
  })
})

describe('parseMajorAmount', () => {
  it('reads typed amounts', () => {
    expect(parseMajorAmount('2,500.50', 'INR')).toEqual({ ok: true, value: 2500.5 })
    expect(parseMajorAmount('5000', 'JPY')).toEqual({ ok: true, value: 5000 })
    expect(parseMajorAmount('5000.00', 'JPY')).toEqual({ ok: true, value: 5000 })
  })

  it('rejects fractions a currency cannot hold', () => {
    expect(parseMajorAmount('5000.5', 'JPY').ok).toBe(false)
    expect(parseMajorAmount('1.234', 'USD').ok).toBe(false)
  })

  it('rejects junk', () => {
    expect(parseMajorAmount('', 'USD').ok).toBe(false)
    expect(parseMajorAmount('-5', 'USD').ok).toBe(false)
    expect(parseMajorAmount('abc', 'USD').ok).toBe(false)
  })
})
