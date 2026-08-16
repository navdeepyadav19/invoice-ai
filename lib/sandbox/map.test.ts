import { describe, expect, it } from 'vitest'

import { isInactive, normaliseBusinessType, toPrefilledBusiness } from './map'
import type { GstTaxpayer } from './client'

/** A real-shaped payload, matching the documented Search GSTIN response. */
const KARNATAKA_PVT_LTD: GstTaxpayer = {
  gstin: '29AFSPB9500E1ZY',
  lgnm: 'Vicky Pvt Ltd',
  tradeNam: 'Vicky',
  dty: 'Regular',
  sts: 'Active',
  ctb: 'Private Limited Company',
  rgdt: '18/10/2019',
  nba: ['Supplier of Services'],
  pradr: {
    addr: {
      bno: '26666, Block 77',
      bnm: 'Wellington New Place, Prestige Shantiniketan',
      flno: 'Level 05',
      st: 'Whitefield Main Road, Near ITPL',
      loc: 'Bangalore',
      dst: 'Bengaluru Urban',
      stcd: 'Karnataka',
      pncd: '560048',
    },
    ntr: 'Supplier of Services',
  },
}

describe('normaliseBusinessType', () => {
  it('maps the constitutions the GST portal actually returns', () => {
    expect(normaliseBusinessType('Proprietorship')).toBe('sole_trader')
    expect(normaliseBusinessType('Sole Proprietorship')).toBe('sole_trader')
    expect(normaliseBusinessType('Individual')).toBe('sole_trader')
    expect(normaliseBusinessType('Partnership')).toBe('partnership')
    expect(normaliseBusinessType('Limited Liability Partnership')).toBe('partnership')
    expect(normaliseBusinessType('Private Limited Company')).toBe('limited_company')
    expect(normaliseBusinessType('Public Limited Company')).toBe('limited_company')
  })

  it('prefers partnership over limited for an LLP', () => {
    // "Limited Liability Partnership" contains both "limited" and "partnership".
    // Partnership must win, so the order of checks in the mapper matters.
    expect(normaliseBusinessType('Limited Liability Partnership')).toBe('partnership')
  })

  it('falls back to other rather than guessing', () => {
    expect(normaliseBusinessType('Society/ Club/ Trust/ AOP')).toBe('other')
    expect(normaliseBusinessType('')).toBe('other')
    expect(normaliseBusinessType(null)).toBe('other')
  })
})

describe('toPrefilledBusiness', () => {
  it('maps a full taxpayer record', () => {
    const result = toPrefilledBusiness(KARNATAKA_PVT_LTD)

    expect(result.legal_name).toBe('Vicky Pvt Ltd')
    expect(result.trade_name).toBe('Vicky')
    expect(result.business_type).toBe('limited_company')
    expect(result.city).toBe('Bangalore')
    expect(result.pincode).toBe('560048')
    expect(result.gst_status).toBe('Active')
  })

  it('takes the state code from the GSTIN, not the address', () => {
    // The address says "Karnataka" as a NAME; the code must come from the
    // GSTIN prefix so we never have to match state names to numbers.
    expect(toPrefilledBusiness(KARNATAKA_PVT_LTD).state_code).toBe('29')
  })

  it('rejects a state code the GSTIN prefix does not recognise', () => {
    // 25 was merged into 26 in 2020 and is no longer a valid code.
    const stale = { ...KARNATAKA_PVT_LTD, gstin: '25AFSPB9500E1ZY' }
    expect(toPrefilledBusiness(stale).state_code).toBe('')
  })

  it('splits the address fragments across two lines', () => {
    const result = toPrefilledBusiness(KARNATAKA_PVT_LTD)

    expect(result.address_line1).toBe('26666, Block 77, Level 05')
    expect(result.address_line2).toBe(
      'Wellington New Place, Prestige Shantiniketan, Whitefield Main Road, Near ITPL',
    )
  })

  it('survives a record with no address at all', () => {
    const bare: GstTaxpayer = { gstin: '27AAPFU0939F1ZV', lgnm: 'Bare Co', sts: 'Active' }
    const result = toPrefilledBusiness(bare)

    expect(result.address_line1).toBeNull()
    expect(result.city).toBeNull()
    expect(result.state_code).toBe('27')
    expect(result.legal_name).toBe('Bare Co')
  })

  it('falls back to district when the town is missing', () => {
    const noLoc: GstTaxpayer = {
      ...KARNATAKA_PVT_LTD,
      pradr: { addr: { ...KARNATAKA_PVT_LTD.pradr!.addr!, loc: '' } },
    }
    expect(toPrefilledBusiness(noLoc).city).toBe('Bengaluru Urban')
  })

  it('treats an empty trade name as absent rather than blank', () => {
    const noTrade: GstTaxpayer = { ...KARNATAKA_PVT_LTD, tradeNam: '   ' }
    expect(toPrefilledBusiness(noTrade).trade_name).toBeNull()
  })
})

describe('isInactive', () => {
  it('flags anything that is not Active', () => {
    expect(isInactive(KARNATAKA_PVT_LTD)).toBe(false)
    expect(isInactive({ ...KARNATAKA_PVT_LTD, sts: 'Cancelled' })).toBe(true)
    expect(isInactive({ ...KARNATAKA_PVT_LTD, sts: 'Suspended' })).toBe(true)
    expect(isInactive({ ...KARNATAKA_PVT_LTD, sts: undefined })).toBe(true)
  })
})
