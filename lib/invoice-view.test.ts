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
    legal_name: 'Acme Traders Pvt Ltd',
    trade_name: 'Acme',
    gstin: '27AAPFU0939F1ZV',
    state_code: '27',
    is_gst_registered: true,
    bank_name: 'HDFC Bank',
    account_number: '000123456789',
    ifsc: 'HDFC0000001',
    upi_id: 'acme@hdfc',
  } as BusinessRow

  it('stores the legal name as the party name', () => {
    expect(snapshotBusiness(row).name).toBe('Acme Traders Pvt Ltd')
  })

  it('nests bank and UPI details under payment', () => {
    expect(snapshotBusiness(row).payment).toMatchObject({
      bank_name: 'HDFC Bank',
      ifsc: 'HDFC0000001',
      upi_id: 'acme@hdfc',
    })
  })
})

describe('readSnapshot', () => {
  it('returns a stored object as-is', () => {
    const stored = { name: 'Client Co', gstin: '29ABCDE1234F1Z5' }
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
  it('puts city and pincode on one line', () => {
    expect(
      formatPartyAddress({
        name: 'Client Co',
        address_line1: '12 MG Road',
        city: 'Pune',
        pincode: '411001',
        country: 'India',
      }),
    ).toEqual(['12 MG Road', 'Pune 411001', 'India'])
  })

  it('drops blank and whitespace-only lines', () => {
    expect(
      formatPartyAddress({
        name: 'Client Co',
        address_line1: '  12 MG Road  ',
        address_line2: '   ',
        city: null,
        pincode: '411001',
      }),
    ).toEqual(['12 MG Road', '411001'])
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

  it('formats as day, short month, year', () => {
    // ICU versions disagree on "Sep" vs "Sept" for en-IN, so match either.
    expect(formatInvoiceDate('2026-09-14T12:00:00')).toMatch(/^14 Sept? 2026$/)
  })
})
