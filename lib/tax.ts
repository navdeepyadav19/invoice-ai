/**
 * Generic exclusive tax on line items.
 *
 * Integer minor units throughout — see lib/money.ts. The server never trusts
 * totals from the client; it re-runs `computeInvoice` before persisting.
 */

import { amountInWords, mulMinor, toMinor } from './money'

export interface TaxLineInput {
  description: string
  quantity: number
  unit: string
  /** Unit price in major currency units. */
  rate: number
  discountPercent: number
  /** Tax percentage, exclusive. */
  taxRate: number
}

export interface TaxLineResult extends TaxLineInput {
  grossMinor: number
  discountMinor: number
  taxableMinor: number
  taxMinor: number
  totalMinor: number
}

export interface TaxSummaryRow {
  taxRate: number
  taxableMinor: number
  taxMinor: number
}

export interface TaxInvoiceInput {
  lines: TaxLineInput[]
}

export interface TaxInvoiceResult {
  lines: TaxLineResult[]
  taxSummary: TaxSummaryRow[]
  subtotalMinor: number
  discountTotalMinor: number
  taxableTotalMinor: number
  taxTotalMinor: number
  totalMinor: number
  amountInWords: string
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, 100)
}

function computeLine(line: TaxLineInput): TaxLineResult {
  const rateMinor = toMinor(line.rate)
  const grossMinor = mulMinor(rateMinor, line.quantity)
  const discountPct = clampPercent(line.discountPercent)
  const discountMinor = mulMinor(grossMinor, discountPct / 100)
  const taxableMinor = grossMinor - discountMinor
  const taxMinor = mulMinor(taxableMinor, clampPercent(line.taxRate) / 100)

  return {
    ...line,
    grossMinor,
    discountMinor,
    taxableMinor,
    taxMinor,
    totalMinor: taxableMinor + taxMinor,
  }
}

export function computeInvoice(input: TaxInvoiceInput, currency = 'USD'): TaxInvoiceResult {
  const lines = input.lines.map(computeLine)
  const sum = (pick: (l: TaxLineResult) => number) => lines.reduce((acc, l) => acc + pick(l), 0)

  const subtotalMinor = sum((l) => l.grossMinor)
  const discountTotalMinor = sum((l) => l.discountMinor)
  const taxableTotalMinor = sum((l) => l.taxableMinor)
  const taxTotalMinor = sum((l) => l.taxMinor)

  return {
    lines,
    taxSummary: buildTaxSummary(lines),
    subtotalMinor,
    discountTotalMinor,
    taxableTotalMinor,
    taxTotalMinor,
    totalMinor: taxableTotalMinor + taxTotalMinor,
    amountInWords: amountInWords(taxableTotalMinor + taxTotalMinor, currency),
  }
}

export function buildTaxSummary(lines: TaxLineResult[]): TaxSummaryRow[] {
  const byRate = new Map<number, TaxSummaryRow>()

  for (const line of lines) {
    const existing = byRate.get(line.taxRate) ?? {
      taxRate: line.taxRate,
      taxableMinor: 0,
      taxMinor: 0,
    }
    existing.taxableMinor += line.taxableMinor
    existing.taxMinor += line.taxMinor
    byRate.set(line.taxRate, existing)
  }

  return [...byRate.values()].sort((a, b) => a.taxRate - b.taxRate)
}
