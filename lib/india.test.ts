import { describe, expect, it } from 'vitest'

import { GST_RATES, GST_STATES, financialYearLabel, isValidStateCode, stateName } from './india'

describe('GST state codes', () => {
  it('has unique, two-digit codes', () => {
    const codes = GST_STATES.map((s) => s.code)
    expect(new Set(codes).size).toBe(codes.length)
    for (const code of codes) expect(code).toMatch(/^\d{2}$/)
  })

  it('resolves a code to its state name', () => {
    expect(stateName('27')).toBe('Maharashtra')
    expect(stateName('07')).toBe('Delhi')
  })

  it('returns an empty name for missing or unknown codes rather than throwing', () => {
    expect(stateName(null)).toBe('')
    expect(stateName(undefined)).toBe('')
    expect(stateName('')).toBe('')
    expect(stateName('99')).toBe('')
  })

  it('rejects code 25, merged into 26 in 2020', () => {
    expect(isValidStateCode('25')).toBe(false)
    expect(isValidStateCode('26')).toBe(true)
  })

  it('accepts the export and other-territory codes', () => {
    expect(isValidStateCode('96')).toBe(true)
    expect(isValidStateCode('97')).toBe(true)
  })

  it('requires the zero-padded form', () => {
    expect(isValidStateCode('7')).toBe(false)
  })
})

describe('GST slabs', () => {
  it('offers only real slabs', () => {
    expect(GST_RATES).toContain(18)
    expect(GST_RATES).not.toContain(15)
  })
})

describe('financial year across a century', () => {
  // Local-time constructors so the result doesn't depend on the runner's timezone.
  it('wraps the two-digit year at 2099 → 2100', () => {
    expect(financialYearLabel(new Date(2099, 11, 1))).toBe('99-00')
    expect(financialYearLabel(new Date(2100, 0, 15))).toBe('99-00')
    expect(financialYearLabel(new Date(2100, 3, 1))).toBe('00-01')
  })
})
