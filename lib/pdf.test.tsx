import { describe, expect, it } from 'vitest'

import { computeInvoice } from './tax'
import { pdfFilename, renderInvoicePdf } from './pdf'
import type { InvoiceView } from './invoice-view'

function sampleView(overrides: Partial<InvoiceView> = {}): InvoiceView {
  const computed = computeInvoice(
    {
      lines: [
        {
          description: 'Brand identity system',
          quantity: 1,
          unit: 'NOS',
          rate: 60000,
          discountPercent: 0,
          taxRate: 18,
        },
        {
          description: 'Website design, 8 screens',
          quantity: 1,
          unit: 'NOS',
          rate: 32000,
          discountPercent: 0,
          taxRate: 18,
        },
      ],
    },
    'USD',
  )

  return {
    business: {
      name: 'Umbrella Design Studio',
      trade_name: 'Umbrella',
      tax_id: 'US-EIN 12-3456789',
      address_line1: '4th Floor, Trade Centre',
      city: 'Austin',
      region: 'TX',
      postal_code: '73301',
      country_code: 'US',
      country: 'United States',
      email: 'billing@umbrella.co',
      payment: { bank_name: 'First Bank', routing_number: '111000025' },
    },
    client: {
      name: 'Acme Retail LLC',
      city: 'Dallas',
      region: 'TX',
      country_code: 'US',
    },
    number: 'INV-0042',
    status: 'open',
    issueDate: '2026-08-16',
    dueDate: '2026-08-31',
    currency: 'USD',
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
    const raw = (await renderInvoicePdf(sampleView())).toString('latin1')

    expect(raw).toContain('NotoSans')
    expect(raw).not.toMatch(/BaseFont\s*\/Helvetica/)
  }, 30_000)

  it('renders twice in one process without corrupting fonts', async () => {
    // react-pdf's font cache is global and known to corrupt glyphs across
    // successive renders in a warm process — exactly what Fluid Compute does.
    // renderInvoicePdf calls Font.reset(); this is the regression test for it.
    const first = await renderInvoicePdf(sampleView())
    const second = await renderInvoicePdf(sampleView({ number: 'INV-0043' }))

    expect(second.subarray(0, 5).toString()).toBe('%PDF-')
    expect(second.length).toBeGreaterThan(10_000)
    // Same document shape, so the two should be within a few percent of each
    // other. A collapsed second render would be dramatically smaller.
    expect(Math.abs(second.length - first.length) / first.length).toBeLessThan(0.1)
  }, 45_000)

  it('names the file after the invoice number', () => {
    expect(pdfFilename(sampleView())).toBe('INV-0042.pdf')
    expect(pdfFilename(sampleView({ number: null }))).toBe('draft-2026-08-16.pdf')
  })
})
