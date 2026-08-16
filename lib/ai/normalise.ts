import { GST_RATES, GST_STATES, UNITS } from '@/lib/india'
import type { AiInvoiceDraft } from '@/lib/ai/invoice-schema'

/**
 * The shape the builder actually applies to its form.
 *
 * Deliberately narrower than what the model returns: state names have become
 * codes, tax-inclusive amounts have become pre-tax rates, and every enum has
 * been snapped to a value the form can hold.
 */
export interface NormalisedInvoiceDraft {
  client_name: string | null
  client_gstin: string | null
  client_city: string | null
  client_email: string | null
  place_of_supply_state_code: string | null
  due_in_days: number | null
  notes: string | null
  items: Array<{
    description: string
    quantity: number
    unit: string
    rate: number
    gst_rate: number
    hsn_sac: string
  }>
}

/**
 * Two jobs the model must not be trusted with.
 *
 * Converting a tax-inclusive figure back to a pre-tax rate is arithmetic, and
 * language models are unreliable at it — so we do it here. Turning a state name
 * into a GST code is a lookup it would happily hallucinate ("Karnataka" -> 27),
 * and a wrong code silently flips the invoice between CGST/SGST and IGST.
 */
export function normaliseDraft(draft: AiInvoiceDraft): NormalisedInvoiceDraft {
  return {
    client_name: blankToNull(draft.client_name),
    client_gstin: blankToNull(draft.client_gstin)?.toUpperCase() ?? null,
    client_city: blankToNull(draft.client_city),
    client_email: blankToNull(draft.client_email),
    place_of_supply_state_code: stateCodeFromName(draft.place_of_supply_state_name),
    due_in_days:
      typeof draft.due_in_days === 'number' && draft.due_in_days > 0
        ? Math.round(draft.due_in_days)
        : null,
    notes: blankToNull(draft.notes),
    items: draft.items.map((item) => {
      const gstRate = snapGstRate(item.gst_rate)
      const quantity = item.quantity > 0 ? item.quantity : 1
      const rawRate = Number.isFinite(item.rate) && item.rate > 0 ? item.rate : 0

      return {
        description: (item.description ?? '').trim(),
        quantity,
        unit: snapUnit(item.unit),
        // "₹11,800 all in" at 18% is a ₹10,000 line, not an ₹11,800 one.
        rate: draft.amount_is_tax_inclusive ? stripTax(rawRate, gstRate) : round2(rawRate),
        gst_rate: gstRate,
        hsn_sac: blankToNull(item.hsn_sac) ?? '',
      }
    }),
  }
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed.length ? trimmed : null
}

/** Removes the GST component from a tax-inclusive amount. */
function stripTax(amount: number, gstRate: number): number {
  if (gstRate <= 0) return round2(amount)
  return round2(amount / (1 + gstRate / 100))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** Snap to a real GST slab; anything unrecognised falls back to 18%. */
function snapGstRate(rate: number): number {
  const rates = GST_RATES as readonly number[]
  if (rates.includes(rate)) return rate

  if (!Number.isFinite(rate)) return 18

  // Nearest slab beats a hard default when the model says 17 or 20.
  //
  // `<=` matters: GST_RATES is ascending, so on a tie the LAST equidistant slab
  // wins — 4% resolves to 5%, not to the 3% jewellery slab. Ties should round up,
  // because under-charging GST leaves the merchant owing the difference while
  // over-charging is visible on the invoice and gets queried immediately.
  let nearest = 18
  let bestGap = Number.POSITIVE_INFINITY

  for (const candidate of rates) {
    const gap = Math.abs(candidate - rate)
    if (gap <= bestGap) {
      bestGap = gap
      nearest = candidate
    }
  }

  return nearest
}

function snapUnit(unit: string | null | undefined): string {
  const value = (unit ?? '').trim().toUpperCase()
  const units = UNITS as readonly string[]
  if (units.includes(value)) return value

  // Common spoken forms the model returns instead of the UQC code.
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

/**
 * Map a spoken state name to its GST code.
 *
 * Matching is loose on purpose — people say "Bombay", the portal says
 * "Maharashtra" — but it returns null rather than guessing, because a wrong
 * state code changes which taxes are charged.
 */
export function stateCodeFromName(name: string | null | undefined): string | null {
  const value = (name ?? '').trim().toLowerCase()
  if (!value) return null

  const exact = GST_STATES.find((s) => s.name.toLowerCase() === value)
  if (exact) return exact.code

  // A two-digit code spoken directly.
  const asCode = GST_STATES.find((s) => s.code === value)
  if (asCode) return asCode.code

  const partial = GST_STATES.find(
    (s) => s.name.toLowerCase().includes(value) || value.includes(s.name.toLowerCase()),
  )
  return partial?.code ?? null
}
