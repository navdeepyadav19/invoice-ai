import { toPaise, toRupees } from '@/lib/money'

/**
 * The one place rupees become paise and back.
 *
 * Three representations of money exist in this codebase, and mixing them up is
 * how you ship an invoice that is off by a hundred:
 *
 *   lib/gst.ts     integer paise    2500000      the tax engine, exact
 *   Postgres       numeric(14,2)    25000.00     the stored row, exact decimal
 *   REST API       integer paise    2500000      the wire contract, no floats
 *
 * The database is the odd one out. It stores rupees because the schema was
 * written for the web UI, where a form field holds "25000.00". The API uses
 * paise because JSON numbers are IEEE doubles and 0.1 + 0.2 is not 0.3 — a
 * contract that puts rupees on the wire is a contract that will eventually
 * disagree with itself about a total.
 *
 * So the API and the tax engine already agree, and only the row needs bridging.
 * `Number(row.total)` is deliberate: postgres numeric arrives from postgrest as
 * a *string* to avoid precision loss, and silently comparing that string to a
 * number is a bug that typechecks.
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
  cgst_total: StoredAmount
  sgst_total: StoredAmount
  igst_total: StoredAmount
  cess_total: StoredAmount
  round_off: StoredAmount
  total: StoredAmount
}) {
  return {
    subtotal_paise: storedToPaise(row.subtotal),
    discount_total_paise: storedToPaise(row.discount_total),
    taxable_total_paise: storedToPaise(row.taxable_total),
    cgst_total_paise: storedToPaise(row.cgst_total),
    sgst_total_paise: storedToPaise(row.sgst_total),
    igst_total_paise: storedToPaise(row.igst_total),
    cess_total_paise: storedToPaise(row.cess_total),
    round_off_paise: storedToPaise(row.round_off),
    total_paise: storedToPaise(row.total),
  }
}

/** Every money column on `invoice_items`, converted for the wire. */
export function lineItemAmountsToPaise(row: {
  taxable_value: StoredAmount
  cgst_amount: StoredAmount
  sgst_amount: StoredAmount
  igst_amount: StoredAmount
  cess_amount: StoredAmount
  line_total: StoredAmount
}) {
  return {
    taxable_value_paise: storedToPaise(row.taxable_value),
    cgst_amount_paise: storedToPaise(row.cgst_amount),
    sgst_amount_paise: storedToPaise(row.sgst_amount),
    igst_amount_paise: storedToPaise(row.igst_amount),
    cess_amount_paise: storedToPaise(row.cess_amount),
    line_total_paise: storedToPaise(row.line_total),
  }
}
