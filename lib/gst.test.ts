import { describe, expect, it } from 'vitest'

import { computeInvoice, type GstInvoiceInput, type GstLineInput } from './gst'
import { amountInWords, toRupees } from './money'
import { financialYearLabel } from './india'

function line(overrides: Partial<GstLineInput> = {}): GstLineInput {
  return {
    description: 'Consulting',
    hsnSac: '998311',
    quantity: 1,
    unit: 'NOS',
    rate: 1000,
    discountPercent: 0,
    gstRate: 18,
    cessRate: 0,
    ...overrides,
  }
}

function invoice(overrides: Partial<GstInvoiceInput> = {}): GstInvoiceInput {
  return {
    supplierStateCode: '27',
    placeOfSupplyStateCode: '27',
    supplierIsGstRegistered: true,
    lines: [line()],
    ...overrides,
  }
}

describe('place of supply', () => {
  it('splits into CGST and SGST when supplier and place of supply match', () => {
    const r = computeInvoice(invoice())

    expect(r.treatment).toBe('intra_state')
    expect(toRupees(r.cgstTotalPaise)).toBe(90)
    expect(toRupees(r.sgstTotalPaise)).toBe(90)
    expect(r.igstTotalPaise).toBe(0)
    expect(toRupees(r.totalPaise)).toBe(1180)
  })

  it('charges a single IGST when the states differ', () => {
    const r = computeInvoice(invoice({ placeOfSupplyStateCode: '29' }))

    expect(r.treatment).toBe('inter_state')
    expect(toRupees(r.igstTotalPaise)).toBe(180)
    expect(r.cgstTotalPaise + r.sgstTotalPaise).toBe(0)
    expect(toRupees(r.totalPaise)).toBe(1180)
  })

  it('collects the same total either way — only the split changes', () => {
    const intra = computeInvoice(invoice())
    const inter = computeInvoice(invoice({ placeOfSupplyStateCode: '29' }))

    expect(intra.totalPaise).toBe(inter.totalPaise)
  })

  it('treats a foreign place of supply as a zero-rated export, not inter-state', () => {
    const r = computeInvoice(invoice({ placeOfSupplyStateCode: '96' }))

    expect(r.treatment).toBe('export')
    expect(r.taxTotalPaise).toBe(0)
    expect(toRupees(r.totalPaise)).toBe(1000)
  })
})

describe('rounding', () => {
  it('never loses a paisa when halving an odd tax amount', () => {
    // 900p taxable at 5% = 45p of tax, which cannot be halved evenly.
    const r = computeInvoice(invoice({ lines: [line({ rate: 9, gstRate: 5 })] }))

    expect(r.cgstTotalPaise).toBe(23)
    expect(r.sgstTotalPaise).toBe(22)
    expect(r.cgstTotalPaise + r.sgstTotalPaise).toBe(45)
  })

  it('rounds the payable to a whole rupee and records the adjustment', () => {
    // 99999p + 18% = 117999p, one paisa short of a whole rupee.
    const r = computeInvoice(invoice({ lines: [line({ rate: 999.99 })] }))

    expect(r.roundOffPaise).toBe(1)
    expect(toRupees(r.totalPaise)).toBe(1180)
  })

  it('rounds down when that is nearer, giving a negative adjustment', () => {
    // 100049p at 0% -> 1000.49, nearest rupee is 1000.
    const r = computeInvoice(invoice({ lines: [line({ rate: 1000.49, gstRate: 0 })] }))

    expect(r.roundOffPaise).toBe(-49)
    expect(toRupees(r.totalPaise)).toBe(1000)
  })

  it('keeps the total reconcilable: taxable + tax + roundOff === total', () => {
    const r = computeInvoice(
      invoice({
        lines: [
          line({ rate: 333.33, quantity: 3, gstRate: 18 }),
          line({ rate: 77.77, quantity: 7, gstRate: 12 }),
          line({ rate: 12.5, quantity: 2.5, gstRate: 5 }),
        ],
      }),
    )

    expect(r.taxableTotalPaise + r.taxTotalPaise + r.roundOffPaise).toBe(r.totalPaise)
  })

  it('survives float-hostile quantities without drift', () => {
    // 0.1 + 0.2 territory: three lines that a naive float sum gets wrong.
    const r = computeInvoice(
      invoice({
        lines: [
          line({ rate: 0.1, quantity: 1, gstRate: 0 }),
          line({ rate: 0.2, quantity: 1, gstRate: 0 }),
        ],
      }),
    )

    expect(r.taxableTotalPaise).toBe(30)
  })
})

describe('discounts', () => {
  it('charges tax on the discounted value, not the gross', () => {
    const r = computeInvoice(invoice({ lines: [line({ discountPercent: 10 })] }))

    expect(toRupees(r.subtotalPaise)).toBe(1000)
    expect(toRupees(r.discountTotalPaise)).toBe(100)
    expect(toRupees(r.taxableTotalPaise)).toBe(900)
    expect(toRupees(r.cgstTotalPaise)).toBe(81)
    expect(toRupees(r.totalPaise)).toBe(1062)
  })

  it('ignores a nonsensical discount rather than producing negative tax', () => {
    const r = computeInvoice(invoice({ lines: [line({ discountPercent: -5 })] }))

    expect(r.discountTotalPaise).toBe(0)
  })
})

describe('mixed slabs', () => {
  it('taxes each line at its own rate and groups the summary by rate', () => {
    const r = computeInvoice(
      invoice({
        lines: [
          line({ description: 'Design', rate: 1000, gstRate: 18 }),
          line({ description: 'Printing', rate: 500, gstRate: 12 }),
          line({ description: 'Courier', rate: 200, gstRate: 18 }),
        ],
      }),
    )

    expect(r.taxSummary).toHaveLength(2)

    const twelve = r.taxSummary.find((row) => row.gstRate === 12)!
    const eighteen = r.taxSummary.find((row) => row.gstRate === 18)!

    expect(toRupees(twelve.taxablePaise)).toBe(500)
    expect(toRupees(twelve.cgstPaise + twelve.sgstPaise)).toBe(60)

    // 18% lines are merged into one summary row: 1000 + 200 = 1200 taxable.
    expect(toRupees(eighteen.taxablePaise)).toBe(1200)
    expect(toRupees(eighteen.cgstPaise + eighteen.sgstPaise)).toBe(216)
  })
})

describe('non-taxable supplies', () => {
  it('charges nothing when the supplier is not GST registered', () => {
    const r = computeInvoice(invoice({ supplierIsGstRegistered: false }))

    expect(r.treatment).toBe('unregistered')
    expect(r.taxTotalPaise).toBe(0)
    expect(toRupees(r.totalPaise)).toBe(1000)
  })

  it('collects no tax under reverse charge but keeps the taxable value', () => {
    const r = computeInvoice(invoice({ reverseCharge: true }))

    expect(r.reverseCharge).toBe(true)
    expect(r.treatment).toBe('intra_state')
    expect(r.taxTotalPaise).toBe(0)
    expect(toRupees(r.taxableTotalPaise)).toBe(1000)
  })
})

describe('compensation cess', () => {
  it('adds cess on top of GST on the same taxable base', () => {
    const r = computeInvoice(invoice({ lines: [line({ gstRate: 28, cessRate: 12 })] }))

    expect(toRupees(r.cessTotalPaise)).toBe(120)
    expect(toRupees(r.cgstTotalPaise + r.sgstTotalPaise)).toBe(280)
    expect(toRupees(r.totalPaise)).toBe(1400)
  })
})

describe('amount in words', () => {
  it('uses lakh and crore, not million', () => {
    expect(amountInWords(1_25_00_000_00)).toBe('One Crore Twenty Five Lakh Rupees Only')
    expect(amountInWords(150000)).toBe('One Thousand Five Hundred Rupees Only')
  })

  it('names the paise when the amount is not whole', () => {
    expect(amountInWords(118050)).toBe('One Thousand One Hundred Eighty Rupees and Fifty Paise Only')
  })

  it('handles zero', () => {
    expect(amountInWords(0)).toBe('Zero Rupees Only')
  })

  it('is wired into the invoice result', () => {
    const r = computeInvoice(invoice())
    expect(r.amountInWords).toBe('One Thousand One Hundred Eighty Rupees Only')
  })
})

describe('financial year', () => {
  it('starts the year in April', () => {
    expect(financialYearLabel(new Date('2026-08-16'))).toBe('26-27')
    expect(financialYearLabel(new Date('2026-04-01'))).toBe('26-27')
    expect(financialYearLabel(new Date('2026-03-31'))).toBe('25-26')
  })
})
