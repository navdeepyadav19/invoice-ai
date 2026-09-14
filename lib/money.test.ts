import { describe, expect, it } from 'vitest'

import {
  amountInWords,
  formatPaise,
  formatPaisePlain,
  mulPaise,
  roundToRupee,
  toPaise,
  toRupees,
} from './money'

describe('paise conversion', () => {
  it('turns float-hostile rupee sums into exact integers', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754 — the whole reason paise exist.
    expect(toPaise(0.1 + 0.2)).toBe(30)
  })

  it('rounds sub-paisa input to the nearest paisa', () => {
    expect(toPaise(19.999)).toBe(2000)
    expect(toPaise(19.994)).toBe(1999)
  })

  it('round-trips back to rupees', () => {
    expect(toRupees(toPaise(1234.56))).toBe(1234.56)
  })
})

describe('mulPaise', () => {
  it('rounds half-up for positive amounts', () => {
    expect(mulPaise(5, 0.5)).toBe(3)
    expect(mulPaise(1000, 0.185)).toBe(185)
  })

  it('rounds credit lines away from zero, where Math.round alone would drift', () => {
    expect(Math.round(-2.5)).toBe(-2)
    expect(mulPaise(-5, 0.5)).toBe(-3)
  })

  it('is exact for whole results', () => {
    expect(mulPaise(118000, 1)).toBe(118000)
    expect(mulPaise(0, 0.18)).toBe(0)
  })
})

describe('roundToRupee', () => {
  it('rounds to the nearer whole rupee', () => {
    expect(roundToRupee(11849)).toBe(11800)
    expect(roundToRupee(11850)).toBe(11900)
  })
})

describe('display formatting', () => {
  it('groups digits the Indian way (lakh, not million)', () => {
    const formatted = formatPaise(1_23_45_678_90)
    expect(formatted.startsWith('₹')).toBe(true)
    expect(formatted).toContain('1,23,45,678.90')
  })

  it('always shows two decimals in table columns, with no symbol', () => {
    expect(formatPaisePlain(1000)).toBe('10.00')
    expect(formatPaisePlain(5)).toBe('0.05')
  })
})

describe('amountInWords edge cases', () => {
  it('names amounts under a rupee', () => {
    expect(amountInWords(99)).toBe('Zero Rupees and Ninety Nine Paise Only')
  })

  it('prefixes credit notes with Minus', () => {
    expect(amountInWords(-50000)).toBe('Minus Five Hundred Rupees Only')
  })

  it('skips empty lakh and thousand groups instead of saying "Zero Lakh"', () => {
    expect(amountInWords(1_00_00_101_00)).toBe('One Crore One Hundred One Rupees Only')
  })

  it('lets the crore group grow past 99', () => {
    expect(amountInWords(100_00_00_000_00)).toBe('One Hundred Crore Rupees Only')
  })

  it('handles teens and round tens', () => {
    expect(amountInWords(1_999_00)).toBe('One Thousand Nine Hundred Ninety Nine Rupees Only')
    expect(amountInWords(20_00)).toBe('Twenty Rupees Only')
    expect(amountInWords(13_00)).toBe('Thirteen Rupees Only')
  })

  it('uses the currency code and cents for export invoices', () => {
    expect(amountInWords(12345, 'USD')).toBe('One Hundred Twenty Three USD and Forty Five Cents Only')
    expect(amountInWords(0, 'USD')).toBe('Zero Only')
  })
})
