import { UNITS } from '@/lib/units'
import type { AiInvoiceDraft } from '@/lib/ai/invoice-schema'

/**
 * The shape the builder actually applies to its form.
 *
 * Deliberately narrower than what the model returns: tax-inclusive amounts
 * have become pre-tax rates, and every enum has been snapped to a value the
 * form can hold.
 */
export interface NormalisedInvoiceDraft {
  client_name: string | null
  client_city: string | null
  client_email: string | null
  due_in_days: number | null
  notes: string | null
  items: Array<{
    description: string
    quantity: number
    unit: string
    rate: number
    tax_rate: number
  }>
}

/**
 * One job the model must not be trusted with.
 *
 * Converting a tax-inclusive figure back to a pre-tax rate is arithmetic, and
 * language models are unreliable at it — so we do it here.
 */
export function normaliseDraft(draft: AiInvoiceDraft, fallbackTaxRate = 0): NormalisedInvoiceDraft {
  return {
    client_name: blankToNull(draft.client_name),
    client_city: blankToNull(draft.client_city),
    client_email: blankToNull(draft.client_email),
    due_in_days:
      typeof draft.due_in_days === 'number' && draft.due_in_days > 0
        ? Math.round(draft.due_in_days)
        : null,
    notes: blankToNull(draft.notes),
    items: draft.items.map((item) => {
      const taxRate = clampPercent(item.tax_rate ?? fallbackTaxRate)
      const quantity = item.quantity > 0 ? item.quantity : 1
      const rawRate = Number.isFinite(item.rate) && item.rate > 0 ? item.rate : 0

      return {
        description: (item.description ?? '').trim(),
        quantity,
        unit: snapUnit(item.unit),
        // "$11,800 all in" at 18% is a $10,000 line, not an $11,800 one.
        rate: draft.amount_is_tax_inclusive ? stripTax(rawRate, taxRate) : round2(rawRate),
        tax_rate: taxRate,
      }
    }),
  }
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length ? trimmed : null
}

/** Removes the tax component from a tax-inclusive amount. */
function stripTax(amount: number, taxRate: number): number {
  if (taxRate <= 0) return round2(amount)
  return round2(amount / (1 + taxRate / 100))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.min(value, 100)
}

function snapUnit(unit: string | null | undefined): string {
  const value = (unit ?? '').trim().toUpperCase()
  const units = UNITS as readonly string[]
  if (units.includes(value)) return value

  // Common spoken forms the model returns instead of the unit code.
  const aliases: Record<string, string> = {
    HOUR: 'HRS',
    HOURS: 'HRS',
    HR: 'HRS',
    DAYS: 'DAY',
    MONTH: 'MON',
    MONTHS: 'MON',
    PIECE: 'PCS',
    PIECES: 'PCS',
    KG: 'KGS',
    UNIT: 'NOS',
    UNITS: 'NOS',
    EACH: 'NOS',
  }

  return aliases[value] ?? 'NOS'
}
