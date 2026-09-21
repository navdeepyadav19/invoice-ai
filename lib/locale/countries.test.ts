import { describe, expect, it } from 'vitest'

import {
  countryByCode,
  defaultsForCountry,
  defaultTaxRate,
  isCountryCode,
  taxPresetsForCountry,
} from './countries'

describe('country catalog', () => {
  it('knows major economies with the right default currency', () => {
    expect(countryByCode('US').currency).toBe('USD')
    expect(countryByCode('de').currency).toBe('EUR')
    expect(countryByCode('IN').currency).toBe('INR')
    expect(countryByCode('JP').currency).toBe('JPY')
  })

  it('validates codes case-insensitively', () => {
    expect(isCountryCode('us')).toBe(true)
    expect(isCountryCode('XX')).toBe(false)
  })

  it('falls back to the US for unknown codes', () => {
    expect(countryByCode('XX').code).toBe('US')
    expect(countryByCode(null).code).toBe('US')
  })

  it('derives currency and presets from the country', () => {
    const defaults = defaultsForCountry('FR')

    expect(defaults.currency).toBe('EUR')
    expect(defaults.defaultTaxRate).toBe(20)
  })

  it('gives unlisted countries a no-tax default', () => {
    expect(taxPresetsForCountry('US')).toEqual(
      expect.arrayContaining([expect.objectContaining({ rate: 0 })]),
    )
    expect(defaultTaxRate('AQ')).toBe(0)
  })
})
