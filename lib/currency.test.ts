import { describe, expect, it } from 'vitest'

import { currencyDecimals, isStorableMinor, majorToMinor, minorToMajor } from './currency'

describe('currencyDecimals', () => {
  it('follows ISO 4217 minor units', () => {
    expect(currencyDecimals('USD')).toBe(2)
    expect(currencyDecimals('JPY')).toBe(0)
    expect(currencyDecimals('krw')).toBe(0)
    expect(currencyDecimals('KWD')).toBe(3)
    expect(currencyDecimals('INR')).toBe(2)
  })

  it('defaults an unknown code to 2', () => {
    expect(currencyDecimals('XYZ')).toBe(2)
  })
})

describe('major ↔ minor', () => {
  it('JPY 5000 is ¥5000', () => {
    expect(majorToMinor('5000.00', 'JPY')).toBe(5000)
    expect(minorToMajor(5000, 'JPY')).toBe(5000)
  })

  it('USD 2500 is $25.00', () => {
    expect(minorToMajor(2500, 'USD')).toBe(25)
    expect(majorToMinor('25.00', 'USD')).toBe(2500)
  })

  it('KWD 1500 is 1.500', () => {
    expect(minorToMajor(1500, 'KWD')).toBe(1.5)
    expect(majorToMinor('1.50', 'KWD')).toBe(1500)
  })

  it('rounds negatives symmetrically', () => {
    expect(majorToMinor(-0.015, 'USD')).toBe(-majorToMinor(0.015, 'USD'))
  })

  it('knows which three-decimal amounts numeric(14,2) can hold', () => {
    expect(isStorableMinor(1230, 'KWD')).toBe(true)
    expect(isStorableMinor(1234, 'KWD')).toBe(false)
    expect(isStorableMinor(1234, 'USD')).toBe(true)
    expect(isStorableMinor(7, 'JPY')).toBe(true)
  })
})
