import { toRupees } from '@/lib/money'
import { isStorableMinor, majorToMinor, minorToMajor } from '@/lib/currency'
import { ServiceError } from '@/lib/services/errors'

/**
 * The one place major units become minor units and back.
 *
 * Three representations of money exist in this codebase:
 *
 *   lib/tax.ts     integer hundredths   2500000      the tax engine, exact
 *   Postgres       numeric(14,2)        25000.00     the stored row, exact decimal
 *   REST API       integer minor units  2500000      the wire contract, no floats
 *
 * The engine and the row always use two decimals. The wire uses the
 * currency's own minor unit (lib/currency.ts): 25000.00 USD is 2500000 cents,
 * but ¥5000 is 5000 — not 500000 — because the yen has no minor unit.
 *
 * `Number(row.total)` is deliberate: postgres numeric arrives from postgrest as
 * a *string* to avoid precision loss.
 */

/** A stored numeric(14,2) column — string from postgrest, number after a cast. */
export type StoredAmount = string | number

/** A stored major-unit amount → wire minor units in `currency`. */
export function storedToMinor(value: StoredAmount, currency: string): number {
  return majorToMinor(value, currency)
}

/**
 * Wire minor units → a major-unit amount to store.
 *
 * Throws a field-scoped 422 for an amount numeric(14,2) cannot hold exactly
 * (1234 fils is 1.234 KWD) instead of silently rounding someone's price.
 */
export function wireMinorToMajor(minor: number, currency: string, path: string): number {
  if (!isStorableMinor(minor, currency)) {
    throw new ServiceError('validation', 'Some fields need attention.', [
      { path, message: `${currency.toUpperCase()} amounts are stored to 2 decimals — use a multiple of 10.` },
    ])
  }
  return minorToMajor(minor, currency)
}

/** Engine hundredths (lib/tax.ts) → the stored numeric(14,2). Not a wire conversion. */
export function paiseToStored(paise: number): number {
  return toRupees(paise)
}

/** Every money column on `invoices`, converted for the wire in one step. */
export function invoiceTotalsToMinor(row: {
  currency: string
  subtotal: StoredAmount
  discount_total: StoredAmount
  taxable_total: StoredAmount
  tax_total?: StoredAmount | null
  cgst_total?: StoredAmount | null
  sgst_total?: StoredAmount | null
  igst_total?: StoredAmount | null
  cess_total?: StoredAmount | null
  round_off: StoredAmount
  total: StoredAmount
}) {
  const toMinor = (value: StoredAmount) => storedToMinor(value, row.currency)
  const tax =
    row.tax_total != null
      ? toMinor(row.tax_total)
      : toMinor(
          Number(row.cgst_total ?? 0) +
            Number(row.sgst_total ?? 0) +
            Number(row.igst_total ?? 0) +
            Number(row.cess_total ?? 0),
        )
  return {
    subtotal: toMinor(row.subtotal),
    discount_total: toMinor(row.discount_total),
    taxable_total: toMinor(row.taxable_total),
    tax_total: tax,
    round_off: toMinor(row.round_off),
    total: toMinor(row.total),
  }
}

/** Every money column on `invoice_items`, converted for the wire. */
export function lineItemAmountsToMinor(
  row: {
    rate: StoredAmount
    taxable_value: StoredAmount
    tax_amount?: StoredAmount | null
    cgst_amount?: StoredAmount | null
    sgst_amount?: StoredAmount | null
    igst_amount?: StoredAmount | null
    cess_amount?: StoredAmount | null
    line_total: StoredAmount
  },
  currency: string,
) {
  const toMinor = (value: StoredAmount) => storedToMinor(value, currency)
  const tax =
    row.tax_amount != null
      ? toMinor(row.tax_amount)
      : toMinor(
          Number(row.cgst_amount ?? 0) +
            Number(row.sgst_amount ?? 0) +
            Number(row.igst_amount ?? 0) +
            Number(row.cess_amount ?? 0),
        )
  return {
    unit_amount: toMinor(row.rate),
    taxable_value: toMinor(row.taxable_value),
    tax_amount: tax,
    line_total: toMinor(row.line_total),
  }
}
