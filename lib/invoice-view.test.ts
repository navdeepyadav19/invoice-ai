import { describe, expect, it } from 'vitest'

import type { BusinessRow } from './database.types'
import {
  formatInvoiceDate,
  formatPartyAddress,
  readSnapshot,
  snapshotBusiness,
  type PartySnapshot,
} from './invoice-view'

describe('snapshotBusiness', () => {
  const row = {
    legal_name: 'Acme Traders LLC',
    trade_name: 'Acme',
    country_code: 'US',
    currency: 'USD',
    tax_id: 'US-EIN 12-3456789',
    bank_name: 'First Bank',
    account_number: '000123456789',
    routing_number: '111000025',
  } as BusinessRow

  it('stores the legal name as the party name', () => {
    expect(snapshotBusiness(row).name).toBe('Acme Traders LLC')
  })

  it('nests bank details under payment', () => {
    expect(snapshotBusiness(row).payment).toMatchObject({
      bank_name: 'First Bank',
      routing_number: '111000025',
    })
  })

  it('carries country, currency and tax ID', () => {
    expect(snapshotBusiness(row)).toMatchObject({
      country_code: 'US',
      currency: 'USD',
      tax_id: 'US-EIN 12-3456789',
    })
  })
})

describe('readSnapshot', () => {
  it('returns a stored object as-is', () => {
    const stored = { name: 'Client Co', tax_id: 'EU VAT 123' }
    expect(readSnapshot<PartySnapshot>(stored, 'Unknown')).toEqual(stored)
  })

  it('falls back to a visible name for anything that is not an object', () => {
    expect(readSnapshot(null, 'Unknown client')).toEqual({ name: 'Unknown client' })
    expect(readSnapshot('corrupt', 'Unknown client')).toEqual({ name: 'Unknown client' })
    expect(readSnapshot(42, 'Unknown client')).toEqual({ name: 'Unknown client' })
  })

  it('treats a JSON array as corrupt, not as an object', () => {
    expect(readSnapshot([{ name: 'x' }], 'Unknown client')).toEqual({ name: 'Unknown client' })
  })
})

describe('formatPartyAddress', () => {
  it('puts city, region and postal code on one line', () => {
    expect(
      formatPartyAddress({
        name: 'Client Co',
        address_line1: '12 Main St',
        city: 'Austin',
        region: 'TX',
        postal_code: '73301',
        country: 'United States',
      }),
    ).toEqual(['12 Main St', 'Austin, TX, 73301', 'United States'])
  })

  it('drops blank and whitespace-only lines', () => {
    expect(
      formatPartyAddress({
        name: 'Client Co',
        address_line1: '  12 Main St  ',
        address_line2: '   ',
        city: null,
        postal_code: '73301',
      }),
    ).toEqual(['12 Main St', '73301'])
  })

  it('returns no lines for a party with no address', () => {
    expect(formatPartyAddress({ name: 'Client Co' })).toEqual([])
  })
})

describe('formatInvoiceDate', () => {
  it('shows a dash when there is no date, e.g. no due date', () => {
    expect(formatInvoiceDate(null)).toBe('—')
    expect(formatInvoiceDate(undefined)).toBe('—')
    expect(formatInvoiceDate('')).toBe('—')
  })

  it('formats as short month, day, year (US locale)', () => {
    expect(formatInvoiceDate('2026-09-14T12:00:00')).toMatch(/^Sept? 14, 2026$/)
  })
})
