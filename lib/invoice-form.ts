import type { BusinessRow } from '@/lib/database.types'
import type { TaxInvoiceInput } from '@/lib/tax'
import type { Unit } from '@/lib/units'
import { defaultsForCountry } from '@/lib/locale/countries'

/**
 * The shape the builder form holds.
 *
 * Numeric fields are strings because that's what an <input> gives you, and
 * coercing on every keystroke makes "1." or an empty box unrepresentable while
 * the user is still typing. They're coerced once, at the edges: `toTaxInput` for
 * the live preview and Zod's `coerce` on the server.
 */

export interface LineItemFormValue {
  description: string
  quantity: string
  unit: string
  rate: string
  discount_percent: string
  tax_rate: string
}

export interface InvoiceFormValues {
  client: {
    name: string
    tax_id: string
    email: string
    phone: string
    address_line1: string
    address_line2: string
    city: string
    region: string
    postal_code: string
    country_code: string
  }
  issue_date: string
  due_date: string
  currency: string
  notes: string
  terms: string
  items: LineItemFormValue[]
}

export function emptyLineItem(defaultTaxRate = 0): LineItemFormValue {
  return {
    description: '',
    quantity: '1',
    unit: 'NOS',
    rate: '',
    discount_percent: '0',
    tax_rate: String(defaultTaxRate),
  }
}

/** A number from a partially-typed input. "", "1." and "abc" all mean zero. */
export function num(value: string | number | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number.parseFloat(String(value ?? '').trim())
  return Number.isFinite(parsed) ? parsed : 0
}

export function defaultInvoiceValues(business: BusinessRow | null): InvoiceFormValues {
  const today = new Date().toISOString().slice(0, 10)
  const defaults = defaultsForCountry(business?.country_code ?? null)

  return {
    client: {
      name: '',
      tax_id: '',
      email: '',
      phone: '',
      address_line1: '',
      address_line2: '',
      city: '',
      region: '',
      postal_code: '',
      country_code: business?.country_code ?? defaults.country.code,
    },
    issue_date: today,
    due_date: '',
    currency: business?.currency ?? defaults.currency,
    notes: business?.default_notes ?? '',
    terms: business?.default_terms ?? '',
    items: [emptyLineItem(defaults.defaultTaxRate)],
  }
}

/** Translate form values into the tax engine's input. */
export function toTaxInput(values: InvoiceFormValues): TaxInvoiceInput {
  return {
    lines: values.items.map((item) => ({
      description: item.description,
      quantity: num(item.quantity),
      unit: item.unit,
      rate: num(item.rate),
      discountPercent: num(item.discount_percent),
      taxRate: num(item.tax_rate),
    })),
  }
}

/** Translate form values into the server action's payload. */
export function toSavePayload(values: InvoiceFormValues) {
  return {
    client: { ...values.client, country: values.client.country_code },
    issue_date: values.issue_date,
    due_date: values.due_date,
    currency: values.currency,
    notes: values.notes,
    terms: values.terms,
    items: values.items.map((item) => ({
      description: item.description,
      quantity: num(item.quantity),
      // The select can only produce a valid unit, and the server re-validates
      // with z.enum(UNITS) regardless, so narrowing here is safe.
      unit: item.unit as Unit,
      rate: num(item.rate),
      discount_percent: num(item.discount_percent),
      tax_rate: num(item.tax_rate),
    })),
  }
}
