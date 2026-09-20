import { computeInvoice } from '@/lib/tax'
import { formatMinor } from '@/lib/money'
import { localeForCountry } from '@/lib/locale/countries'
import type { NormalisedInvoiceDraft } from '@/lib/ai/normalise'

/**
 * Turn a parsed draft into the confirmation the user reads before anything is
 * applied to the form.
 *
 * The totals here are computed with the real tax engine, not summarised by the
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
  business: { country_code?: string | null },
  currency = 'USD',
): DraftSummary {
  const locale = localeForCountry(business.country_code)

  const computed = computeInvoice(
    {
      lines: draft.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        discountPercent: 0,
        taxRate: item.tax_rate,
      })),
    },
    currency,
  )

  const lines = computed.lines.map((line) => ({
    label: line.description || 'Untitled item',
    detail:
      line.quantity === 1
        ? `${line.taxRate}% tax`
        : `${line.quantity} ${line.unit} × ${formatMinor(Math.round(line.rate * 100), currency, locale)} · ${line.taxRate}% tax`,
    amount: formatMinor(line.taxableMinor, currency, locale),
  }))

  const meta: string[] = []
  if (draft.client_name) meta.push(`Billing ${draft.client_name}`)
  if (draft.due_in_days !== null) meta.push(`Due in ${draft.due_in_days} days`)

  const missing: string[] = []
  if (!draft.client_name) missing.push('client name')
  if (draft.items.length === 0) missing.push('what you are billing for')
  if (draft.items.some((i) => i.rate <= 0)) missing.push('an amount')

  const taxNote =
    computed.taxTotalMinor > 0
      ? `Includes tax ${formatMinor(computed.taxTotalMinor, currency, locale)}`
      : 'No tax charged'

  return {
    lines,
    totalLabel: 'Invoice total',
    total: formatMinor(computed.totalMinor, currency, locale),
    taxNote,
    meta,
    missing,
  }
}
