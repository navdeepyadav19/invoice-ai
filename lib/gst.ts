/**
 * The GST engine.
 *
 * Pure functions, no I/O, no framework imports — so it runs identically in the
 * browser (live preview as the user types) and on the server (authoritative
 * recompute before persisting). The server NEVER trusts totals sent by the
 * client; it re-runs `computeInvoice` on the submitted line items and stores
 * its own answer.
 *
 * Everything internal is integer paise. See lib/money.ts for why.
 */

import { amountInWords, mulPaise, roundToRupee, toPaise } from './money'

export type TaxTreatment =
  /** Supplier and place of supply in the same state: CGST + SGST, split evenly. */
  | 'intra_state'
  /** Different states: a single IGST at the full rate. */
  | 'inter_state'
  /** Zero-rated export supplied under a Letter of Undertaking. */
  | 'export'
  /** Supplier is not GST registered: a Bill of Supply, no tax columns at all. */
  | 'unregistered'

export interface GstLineInput {
  description: string
  hsnSac?: string
  /** Quantity, may be fractional (2.5 hours, 1.75 kg). */
  quantity: number
  unit: string
  /** Price per unit, in rupees. */
  rate: number
  /** Per-line discount, 0-100. */
  discountPercent: number
  /** GST slab as a percentage: 0, 5, 12, 18, 28. */
  gstRate: number
  /** Compensation cess percentage, 0 for almost everything. */
  cessRate?: number
}

export interface GstLineAmounts {
  grossPaise: number
  discountPaise: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
  totalPaise: number
}

export type GstLineResult = GstLineInput & GstLineAmounts

/** One row of the rate-wise tax breakup that must appear on the invoice face. */
export interface TaxSummaryRow {
  gstRate: number
  taxablePaise: number
  cgstPaise: number
  sgstPaise: number
  igstPaise: number
  cessPaise: number
}

export interface GstInvoiceInput {
  /** State the supplier is registered in — the first 2 digits of their GSTIN. */
  supplierStateCode: string
  /** Where the supply is deemed to happen; usually the client's state. */
  placeOfSupplyStateCode: string
  /** False renders a Bill of Supply instead of a Tax Invoice. */
  supplierIsGstRegistered: boolean
  /** Zero-rated export under LUT. */
  isExport?: boolean
  /** Tax payable by the recipient, so the supplier collects none. */
  reverseCharge?: boolean
  lines: GstLineInput[]
}

export interface GstInvoiceResult {
  treatment: TaxTreatment
  reverseCharge: boolean
  lines: GstLineResult[]
  taxSummary: TaxSummaryRow[]
  /** Sum of line values before discount. */
  subtotalPaise: number
  discountTotalPaise: number
  /** Sum of line values after discount — the base tax is charged on. */
  taxableTotalPaise: number
  cgstTotalPaise: number
  sgstTotalPaise: number
  igstTotalPaise: number
  cessTotalPaise: number
  taxTotalPaise: number
  /** Adjustment applied to reach a whole-rupee payable, positive or negative. */
  roundOffPaise: number
  totalPaise: number
  amountInWords: string
}

/**
 * Decide how a supply is taxed.
 *
 * The order matters. Registration is checked first because an unregistered
 * supplier cannot charge tax at all, regardless of geography. Export is checked
 * before the state comparison because an export to a foreign buyer would
 * otherwise be misread as an inter-state supply and attract IGST.
 */
export function resolveTreatment(input: GstInvoiceInput): TaxTreatment {
  if (!input.supplierIsGstRegistered) return 'unregistered'
  if (input.isExport || input.placeOfSupplyStateCode === '96') return 'export'
  return input.supplierStateCode === input.placeOfSupplyStateCode ? 'intra_state' : 'inter_state'
}

function computeLine(
  line: GstLineInput,
  treatment: TaxTreatment,
  taxable: boolean,
): GstLineResult {
  const ratePaise = toPaise(line.rate)
  const grossPaise = mulPaise(ratePaise, line.quantity)

  const discountPct = clampPercent(line.discountPercent)
  const discountPaise = mulPaise(grossPaise, discountPct / 100)
  const taxablePaise = grossPaise - discountPaise

  let cgstPaise = 0
  let sgstPaise = 0
  let igstPaise = 0
  let cessPaise = 0

  if (taxable) {
    const totalTax = mulPaise(taxablePaise, clampPercent(line.gstRate) / 100)

    if (treatment === 'intra_state') {
      // Halve, then derive the second half by subtraction. Deriving rather than
      // rounding twice guarantees cgst + sgst === totalTax exactly, even when
      // the tax is an odd number of paise (e.g. 45p -> 23p + 22p).
      cgstPaise = Math.round(totalTax / 2)
      sgstPaise = totalTax - cgstPaise
    } else if (treatment === 'inter_state') {
      igstPaise = totalTax
    }

    cessPaise = mulPaise(taxablePaise, clampPercent(line.cessRate ?? 0) / 100)
  }

  return {
    ...line,
    grossPaise,
    discountPaise,
    taxablePaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    totalPaise: taxablePaise + cgstPaise + sgstPaise + igstPaise + cessPaise,
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, 100)
}

/**
 * The single entry point. Give it line items and the supply context, get back
 * every number that appears on the invoice.
 */
export function computeInvoice(input: GstInvoiceInput, currency = 'INR'): GstInvoiceResult {
  const treatment = resolveTreatment(input)
  const reverseCharge = Boolean(input.reverseCharge)

  // Under reverse charge the recipient pays the tax directly to the government,
  // so the supplier shows the taxable value but collects nothing. Same for a
  // zero-rated export under LUT and for an unregistered supplier.
  const collectsTax = treatment !== 'unregistered' && treatment !== 'export' && !reverseCharge

  const lines = input.lines.map((line) => computeLine(line, treatment, collectsTax))

  const sum = (pick: (l: GstLineResult) => number) => lines.reduce((acc, l) => acc + pick(l), 0)

  const subtotalPaise = sum((l) => l.grossPaise)
  const discountTotalPaise = sum((l) => l.discountPaise)
  const taxableTotalPaise = sum((l) => l.taxablePaise)
  const cgstTotalPaise = sum((l) => l.cgstPaise)
  const sgstTotalPaise = sum((l) => l.sgstPaise)
  const igstTotalPaise = sum((l) => l.igstPaise)
  const cessTotalPaise = sum((l) => l.cessPaise)
  const taxTotalPaise = cgstTotalPaise + sgstTotalPaise + igstTotalPaise + cessTotalPaise

  const beforeRounding = taxableTotalPaise + taxTotalPaise
  const totalPaise = roundToRupee(beforeRounding)
  const roundOffPaise = totalPaise - beforeRounding

  return {
    treatment,
    reverseCharge,
    lines,
    taxSummary: buildTaxSummary(lines),
    subtotalPaise,
    discountTotalPaise,
    taxableTotalPaise,
    cgstTotalPaise,
    sgstTotalPaise,
    igstTotalPaise,
    cessTotalPaise,
    taxTotalPaise,
    roundOffPaise,
    totalPaise,
    amountInWords: amountInWords(totalPaise, currency),
  }
}

/** Group lines by GST rate — the "HSN/rate-wise summary" block on the invoice. */
export function buildTaxSummary(lines: GstLineResult[]): TaxSummaryRow[] {
  const byRate = new Map<number, TaxSummaryRow>()

  for (const line of lines) {
    const existing = byRate.get(line.gstRate) ?? {
      gstRate: line.gstRate,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
    }
    existing.taxablePaise += line.taxablePaise
    existing.cgstPaise += line.cgstPaise
    existing.sgstPaise += line.sgstPaise
    existing.igstPaise += line.igstPaise
    existing.cessPaise += line.cessPaise
    byRate.set(line.gstRate, existing)
  }

  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate)
}

/**
 * TODO(navdeep) — your call, see the plan.
 *
 * Right now discounts are line-level only: each line carries its own
 * `discountPercent`, tax is charged on the discounted value, and that is what
 * most Indian invoices do.
 *
 * The alternative is an invoice-level discount ("10% off the whole bill")
 * distributed proportionally back across lines BEFORE tax, so each line's tax
 * base shrinks by its fair share. It's friendlier to write and to read, but it
 * changes the taxable value on every line and therefore what you remit — which
 * is why it should be your decision, not mine.
 *
 * If you want it, implement this to return a new set of lines with
 * `discountPercent` adjusted (or an extra absolute discount field), then call it
 * from `computeInvoice` before `computeLine` runs. Watch the rounding: the
 * distributed paise must sum back to exactly `invoiceDiscountPaise`, so give the
 * remainder to the largest line rather than letting each line round independently.
 */
export function distributeInvoiceDiscount(
  lines: GstLineInput[],
  invoiceDiscountPaise: number,
): GstLineInput[] {
  void invoiceDiscountPaise // unused until the strategy above is chosen
  return lines
}
