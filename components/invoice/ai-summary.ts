import { computeInvoice } from '@/lib/gst'
import { formatPaise } from '@/lib/money'
import { stateName } from '@/lib/india'
import type { NormalisedInvoiceDraft } from '@/lib/ai/normalise'

/**
 * Turn a parsed draft into the confirmation the user reads before anything is
 * applied to the form.
 *
 * The totals here are computed with the real GST engine, not summarised by the
 * model. If the confirmation showed a number the model invented, confirming it
 * would mean approving something the app was never going to produce — the whole
 * point of the step is that what you approve is what you get.
 */

export interface DraftSummary {
  lines: Array<{ label: string; detail: string; amount: string }>
  totalLabel: string
  total: string
  taxNote: string
  meta: string[]
  /** Fields the model could not fill, so the user knows what's left to do. */
  missing: string[]
}

export function summariseDraft(
  draft: NormalisedInvoiceDraft,
  business: { state_code: string; is_gst_registered: boolean },
  currency = 'INR',
): DraftSummary {
  const placeOfSupply = draft.place_of_supply_state_code || business.state_code

  const computed = computeInvoice(
    {
      supplierStateCode: business.state_code,
      placeOfSupplyStateCode: placeOfSupply,
      supplierIsGstRegistered: business.is_gst_registered,
      lines: draft.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        discountPercent: 0,
        gstRate: item.gst_rate,
      })),
    },
    currency,
  )

  const lines = computed.lines.map((line) => ({
    label: line.description || 'Untitled item',
    detail:
      line.quantity === 1
        ? `${line.gstRate}% GST`
        : `${line.quantity} ${line.unit} × ${formatPaise(Math.round(line.rate * 100), currency)} · ${line.gstRate}% GST`,
    amount: formatPaise(line.taxablePaise, currency),
  }))

  const meta: string[] = []
  if (draft.client_name) meta.push(`Billing ${draft.client_name}`)
  if (draft.client_gstin) meta.push(`GSTIN ${draft.client_gstin}`)
  if (draft.place_of_supply_state_code) {
    meta.push(`Place of supply ${placeOfSupply} — ${stateName(placeOfSupply)}`)
  }
  if (draft.due_in_days !== null) meta.push(`Due in ${draft.due_in_days} days`)

  const missing: string[] = []
  if (!draft.client_name) missing.push('client name')
  if (draft.items.length === 0) missing.push('what you are billing for')
  if (draft.items.some((i) => i.rate <= 0)) missing.push('an amount')

  const taxNote =
    computed.taxTotalPaise > 0
      ? computed.igstTotalPaise > 0
        ? `Includes IGST ${formatPaise(computed.igstTotalPaise, currency)}`
        : `Includes CGST + SGST ${formatPaise(computed.cgstTotalPaise + computed.sgstTotalPaise, currency)}`
      : 'No GST charged'

  return {
    lines,
    totalLabel: 'Invoice total',
    total: formatPaise(computed.totalPaise, currency),
    taxNote,
    meta,
    missing,
  }
}
