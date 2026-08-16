import { describe, expect, it } from 'vitest'

import { computeInvoice } from './gst'
import { pdfFilename, renderInvoicePdf } from './pdf'
import type { InvoiceView } from './invoice-view'

function sampleView(overrides: Partial<InvoiceView> = {}): InvoiceView {
  const computed = computeInvoice({
    supplierStateCode: '27',
    placeOfSupplyStateCode: '27',
    supplierIsGstRegistered: true,
    lines: [
      {
        description: 'Brand identity system',
        hsnSac: '998912',
        quantity: 1,
        unit: 'NOS',
        rate: 60000,
        discountPercent: 0,
        gstRate: 18,
      },
      {
        description: 'Website design, 8 screens',
        hsnSac: '998314',
        quantity: 1,
        unit: 'NOS',
        rate: 32000,
        discountPercent: 0,
        gstRate: 18,
      },
    ],
  })

  return {
    business: {
      name: 'Umbrella Design Studio',
      trade_name: 'Umbrella',
      gstin: '27AAPFU0939F1ZV',
      address_line1: '4th Floor, Trade Centre',
      city: 'Mumbai',
      state_code: '27',
      pincode: '400051',
      country: 'India',
      email: 'billing@umbrella.in',
      is_gst_registered: true,
      payment: { bank_name: 'HDFC Bank', ifsc: 'HDFC0001234', upi_id: 'umbrella@hdfcbank' },
    },
    client: {
      name: 'Kadam Retail Pvt Ltd',
      gstin: '27AAPFU0939F1ZV',
      city: 'Pune',
      state_code: '27',
      country: 'India',
    },
    number: 'INV/26-27/0042',
    status: 'sent',
    issueDate: '2026-08-16',
    dueDate: '2026-08-31',
    currency: 'INR',
    placeOfSupplyStateCode: '27',
    notes: 'Thank you for your business.',
    terms: 'Payment due within 15 days.',
    computed,
    ...overrides,
  }
}

describe('PDF rendering', () => {
  it('produces a real PDF', async () => {
    const buffer = await renderInvoicePdf(sampleView())

    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-')
    expect(buffer.length).toBeGreaterThan(10_000)
  }, 30_000)

  it('embeds Noto Sans rather than falling back to Helvetica', async () => {
    // Helvetica has no ₹ glyph, so a fallback here would silently blank every
    // rupee sign on the invoice. Checking the embedded font name catches that.
    const raw = (await renderInvoicePdf(sampleView())).toString('latin1')

    expect(raw).toContain('NotoSans')
    expect(raw).not.toMatch(/BaseFont\s*\/Helvetica/)
  }, 30_000)

  it('renders twice in one process without corrupting fonts', async () => {
    // react-pdf's font cache is global and known to corrupt glyphs across
    // successive renders in a warm process — exactly what Fluid Compute does.
    // renderInvoicePdf calls Font.reset(); this is the regression test for it.
    const first = await renderInvoicePdf(sampleView())
    const second = await renderInvoicePdf(sampleView({ number: 'INV/26-27/0043' }))

    expect(second.subarray(0, 5).toString()).toBe('%PDF-')
    expect(second.length).toBeGreaterThan(10_000)
    // Same document shape, so the two should be within a few percent of each
    // other. A collapsed second render would be dramatically smaller.
    expect(Math.abs(second.length - first.length) / first.length).toBeLessThan(0.1)
  }, 45_000)

  it('names the file after the invoice number', () => {
    expect(pdfFilename(sampleView())).toBe('INV-26-27-0042.pdf')
    expect(pdfFilename(sampleView({ number: null }))).toBe('draft-2026-08-16.pdf')
  })
})
