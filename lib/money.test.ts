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
  it('turns float-hostile sums into exact integers', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754 — the whole reason minor units exist.
    expect(toPaise(0.1 + 0.2)).toBe(30)
  })

  it('rounds sub-cent input to the nearest minor unit', () => {
    expect(toPaise(19.999)).toBe(2000)
    expect(toPaise(19.994)).toBe(1999)
  })

  it('round-trips back to major units', () => {
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
  it('rounds to the nearer whole major unit', () => {
    expect(roundToRupee(11849)).toBe(11800)
    expect(roundToRupee(11850)).toBe(11900)
  })
})

describe('display formatting', () => {
  it('formats with the currency and locale', () => {
    const formatted = formatPaise(1234567890, 'USD', 'en-US')
    expect(formatted).toContain('$')
    expect(formatted).toContain('12,345,678.90')
  })

  it('always shows two decimals in table columns, with no symbol', () => {
    expect(formatPaisePlain(1000)).toBe('10.00')
    expect(formatPaisePlain(5)).toBe('0.05')
  })
})

describe('amountInWords edge cases', () => {
  it('names amounts under one major unit', () => {
    expect(amountInWords(99)).toBe('Zero USD and Ninety Nine Cents Only')
  })

  it('prefixes credit notes with Minus', () => {
    expect(amountInWords(-50000)).toBe('Minus Five Hundred USD Only')
  })

  it('skips empty groups instead of saying "Zero Million"', () => {
    expect(amountInWords(10000010100)).toBe('One Hundred Million One Hundred One USD Only')
  })

  it('uses thousand / million / billion grouping', () => {
    expect(amountInWords(199900)).toBe('One Thousand Nine Hundred Ninety Nine USD Only')
    expect(amountInWords(2000)).toBe('Twenty USD Only')
    expect(amountInWords(1300)).toBe('Thirteen USD Only')
    expect(amountInWords(100000000000)).toBe('One Billion USD Only')
  })

  it('uses the currency code and cents', () => {
    expect(amountInWords(12345, 'USD')).toBe('One Hundred Twenty Three USD and Forty Five Cents Only')
    expect(amountInWords(0, 'USD')).toBe('Zero USD Only')
  })
})
