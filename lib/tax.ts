/**
 * Generic exclusive tax on line items.
 *
 * Integer minor units throughout — see lib/money.ts. The server never trusts
 * totals from the client; it re-runs `computeInvoice` before persisting.
 */

import { amountInWords, mulMinor, toMinor } from './money'
import { currencyDecimals, STORED_DECIMALS } from './currency'

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

/**
 * The engine counts in hundredths of a major unit for every currency (that is
 * what numeric(14,2) stores), but a zero-decimal currency has no hundredths:
 * 10% tax on ¥333 is ¥33, not ¥33.30. `step` is how many hundredths make one
 * real minor unit — 100 for JPY, 1 for USD — and every amount is rounded to
 * it, so the stored totals always add up in the currency's own units.
 */
function roundToStep(minor: number, step: number): number {
  if (step === 1) return minor
  const units = Math.round(Math.abs(minor) / step) * step
  return minor < 0 ? -units : units
}

function stepFor(currency: string): number {
  return 10 ** Math.max(0, STORED_DECIMALS - currencyDecimals(currency))
}

function computeLine(line: TaxLineInput, step = 1): TaxLineResult {
  const rateMinor = toMinor(line.rate)
  const grossMinor = roundToStep(mulMinor(rateMinor, line.quantity), step)
  const discountPct = clampPercent(line.discountPercent)
  const discountMinor = roundToStep(mulMinor(grossMinor, discountPct / 100), step)
  const taxableMinor = grossMinor - discountMinor
  const taxMinor = roundToStep(mulMinor(taxableMinor, clampPercent(line.taxRate) / 100), step)

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
  const step = stepFor(currency)
  const lines = input.lines.map((line) => computeLine(line, step))
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
