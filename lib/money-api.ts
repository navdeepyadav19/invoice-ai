import { toPaise, toRupees } from '@/lib/money'

/**
 * The one place major units become minor units and back.
 *
 * Three representations of money exist in this codebase:
 *
 *   lib/tax.ts     integer minor units  2500000      the tax engine, exact
 *   Postgres       numeric(14,2)        25000.00     the stored row, exact decimal
 *   REST API       integer minor units  2500000      the wire contract, no floats
 *
 * The API and the tax engine already agree, and only the row needs bridging.
 * `Number(row.total)` is deliberate: postgres numeric arrives from postgrest as
 * a *string* to avoid precision loss.
 */

/** A stored numeric(14,2) column — string from postgrest, number after a cast. */
export type StoredAmount = string | number

export function storedToPaise(value: StoredAmount): number {
  return toPaise(Number(value))
}

export function paiseToStored(paise: number): number {
  return toRupees(paise)
}

/** Every money column on `invoices`, converted for the wire in one step. */
export function invoiceTotalsToPaise(row: {
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
  const legacyTax =
    row.tax_total != null
      ? storedToPaise(row.tax_total)
      : storedToPaise(row.cgst_total ?? 0) +
        storedToPaise(row.sgst_total ?? 0) +
        storedToPaise(row.igst_total ?? 0) +
        storedToPaise(row.cess_total ?? 0)
  return {
    subtotal_paise: storedToPaise(row.subtotal),
    discount_total_paise: storedToPaise(row.discount_total),
    taxable_total_paise: storedToPaise(row.taxable_total),
    tax_total_paise: legacyTax,
    round_off_paise: storedToPaise(row.round_off),
    total_paise: storedToPaise(row.total),
  }
}

/** Every money column on `invoice_items`, converted for the wire. */
export function lineItemAmountsToPaise(row: {
  taxable_value: StoredAmount
  tax_amount?: StoredAmount | null
  cgst_amount?: StoredAmount | null
  sgst_amount?: StoredAmount | null
  igst_amount?: StoredAmount | null
  cess_amount?: StoredAmount | null
  line_total: StoredAmount
}) {
  const legacyTax =
    row.tax_amount != null
      ? storedToPaise(row.tax_amount)
      : storedToPaise(row.cgst_amount ?? 0) +
        storedToPaise(row.sgst_amount ?? 0) +
        storedToPaise(row.igst_amount ?? 0) +
        storedToPaise(row.cess_amount ?? 0)
  return {
    taxable_value_paise: storedToPaise(row.taxable_value),
    tax_amount_paise: legacyTax,
    line_total_paise: storedToPaise(row.line_total),
  }
}
