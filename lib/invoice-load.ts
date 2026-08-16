import { buildTaxSummary, type GstInvoiceResult, type GstLineResult, type TaxTreatment } from '@/lib/gst'
import { toPaise } from '@/lib/money'
import { readSnapshot, type BusinessSnapshot, type InvoiceView, type PartySnapshot } from '@/lib/invoice-view'
import type { InvoiceItemRow, InvoiceRow } from '@/lib/database.types'

/**
 * Rebuild an InvoiceView from stored rows.
 *
 * This deliberately does NOT re-run the tax engine. Once an invoice has been
 * issued, the document is the numbers that were on it — if a rate changed, or
 * the business moved state, or we fixed a rounding rule, the PDF a client
 * downloads next year must still match the one they were sent. So every figure
 * here is read back from the row, and only the *shape* comes from GstInvoiceResult.
 */
export function viewFromRows(invoice: InvoiceRow, items: InvoiceItemRow[]): InvoiceView {
  const business = readSnapshot<BusinessSnapshot>(invoice.business_snapshot, 'Your business')
  const client = readSnapshot<PartySnapshot>(invoice.client_snapshot, 'Client')

  const lines: GstLineResult[] = items.map((item) => {
    const taxablePaise = toPaise(Number(item.taxable_value))
    const grossPaise = toPaise(Number(item.quantity) * Number(item.rate))

    return {
      description: item.description,
      hsnSac: item.hsn_sac ?? undefined,
      quantity: Number(item.quantity),
      unit: item.unit,
      rate: Number(item.rate),
      discountPercent: Number(item.discount_percent),
      gstRate: Number(item.gst_rate),
      cessRate: Number(item.cess_rate),
      grossPaise,
      discountPaise: grossPaise - taxablePaise,
      taxablePaise,
      cgstPaise: toPaise(Number(item.cgst_amount)),
      sgstPaise: toPaise(Number(item.sgst_amount)),
      igstPaise: toPaise(Number(item.igst_amount)),
      cessPaise: toPaise(Number(item.cess_amount)),
      totalPaise: toPaise(Number(item.line_total)),
    }
  })

  const cgstTotalPaise = toPaise(Number(invoice.cgst_total))
  const sgstTotalPaise = toPaise(Number(invoice.sgst_total))
  const igstTotalPaise = toPaise(Number(invoice.igst_total))
  const cessTotalPaise = toPaise(Number(invoice.cess_total))

  const computed: GstInvoiceResult = {
    treatment: treatmentFor(invoice, business, igstTotalPaise, cgstTotalPaise),
    reverseCharge: invoice.reverse_charge,
    lines,
    taxSummary: buildTaxSummary(lines),
    subtotalPaise: toPaise(Number(invoice.subtotal)),
    discountTotalPaise: toPaise(Number(invoice.discount_total)),
    taxableTotalPaise: toPaise(Number(invoice.taxable_total)),
    cgstTotalPaise,
    sgstTotalPaise,
    igstTotalPaise,
    cessTotalPaise,
    taxTotalPaise: cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise,
    roundOffPaise: toPaise(Number(invoice.round_off)),
    totalPaise: toPaise(Number(invoice.total)),
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
    placeOfSupplyStateCode: invoice.place_of_supply_state_code,
    notes: invoice.notes,
    terms: invoice.terms,
    computed,
  }
}

/**
 * Recover the treatment from what was actually charged.
 *
 * Reading it off the stored amounts rather than recomputing from the current
 * business record means an invoice issued before the supplier registered for GST
 * still prints as a Bill of Supply.
 */
function treatmentFor(
  invoice: InvoiceRow,
  business: BusinessSnapshot,
  igstPaise: number,
  cgstPaise: number,
): TaxTreatment {
  if (invoice.is_export) return 'export'
  if (!business.is_gst_registered) return 'unregistered'
  if (igstPaise > 0) return 'inter_state'
  if (cgstPaise > 0) return 'intra_state'

  // Nothing was collected — fall back to geography so the label still reads
  // correctly on a reverse-charge or zero-rated invoice.
  return business.state_code === invoice.place_of_supply_state_code ? 'intra_state' : 'inter_state'
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
