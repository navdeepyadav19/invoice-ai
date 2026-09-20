import { buildTaxSummary, type TaxInvoiceResult, type TaxLineResult } from '@/lib/tax'
import { toMinor } from '@/lib/money'
import { readSnapshot, type BusinessSnapshot, type InvoiceView, type PartySnapshot } from '@/lib/invoice-view'
import type { InvoiceItemRow, InvoiceRow } from '@/lib/database.types'

/**
 * Rebuild an InvoiceView from stored rows.
 *
 * This deliberately does NOT re-run the tax engine. Once an invoice has been
 * issued, the document is the numbers that were on it. So every figure here is
 * read back from the row; only the *shape* comes from TaxInvoiceResult.
 */
export function viewFromRows(invoice: InvoiceRow, items: InvoiceItemRow[]): InvoiceView {
  const business = readSnapshot<BusinessSnapshot>(invoice.business_snapshot, 'Your business')
  const client = readSnapshot<PartySnapshot>(invoice.client_snapshot, 'Client')

  const lines: TaxLineResult[] = items.map((item) => {
    const taxableMinor = toMinor(Number(item.taxable_value))
    const grossMinor = toMinor(Number(item.quantity) * Number(item.rate))
    const taxRate = Number(item.tax_rate ?? item.gst_rate ?? 0)
    const taxMinor = toMinor(Number(item.tax_amount ?? 0))

    return {
      description: item.description,
      quantity: Number(item.quantity),
      unit: item.unit,
      rate: Number(item.rate),
      discountPercent: Number(item.discount_percent),
      taxRate,
      grossMinor,
      discountMinor: grossMinor - taxableMinor,
      taxableMinor,
      taxMinor,
      totalMinor: toMinor(Number(item.line_total)),
    }
  })

  const subtotalMinor = toMinor(Number(invoice.subtotal))
  const discountTotalMinor = toMinor(Number(invoice.discount_total))
  const taxableTotalMinor = toMinor(Number(invoice.taxable_total))
  const taxTotalMinor = toMinor(Number(invoice.tax_total ?? 0))
  const totalMinor = toMinor(Number(invoice.total))

  const computed: TaxInvoiceResult = {
    lines,
    taxSummary: buildTaxSummary(lines),
    subtotalMinor,
    discountTotalMinor,
    taxableTotalMinor,
    taxTotalMinor,
    totalMinor,
    amountInWords: invoice.amount_in_words ?? '',
  }

  return {
    business,
    client,
    number: invoice.invoice_number,
    status: invoice.status,
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    currency: invoice.currency,
    notes: invoice.notes,
    terms: invoice.terms,
    computed,
  }
}

/** Shape returned by the get_public_invoice SQL function. */
export interface PublicInvoicePayload {
  invoice: InvoiceRow
  items: InvoiceItemRow[]
}

export function isPublicInvoicePayload(value: unknown): value is PublicInvoicePayload {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return Boolean(candidate.invoice) && Array.isArray(candidate.items)
}
