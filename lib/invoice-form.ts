import type { BusinessRow } from '@/lib/database.types'
import type { GstInvoiceInput } from '@/lib/gst'
import type { Unit } from '@/lib/india'

/**
 * The shape the builder form holds.
 *
 * Numeric fields are strings because that's what an <input> gives you, and
 * coercing on every keystroke makes "1." or an empty box unrepresentable while
 * the user is still typing. They're coerced once, at the edges: `toGstInput` for
 * the live preview and Zod's `coerce` on the server.
 */

export interface LineItemFormValue {
  description: string
  hsn_sac: string
  quantity: string
  unit: string
  rate: string
  discount_percent: string
  gst_rate: string
  cess_rate: string
}

export interface InvoiceFormValues {
  client: {
    name: string
    gstin: string
    email: string
    phone: string
    address_line1: string
    address_line2: string
    city: string
    state_code: string
    pincode: string
    country: string
  }
  issue_date: string
  due_date: string
  place_of_supply_state_code: string
  is_export: boolean
  reverse_charge: boolean
  currency: string
  notes: string
  terms: string
  items: LineItemFormValue[]
}

export function emptyLineItem(): LineItemFormValue {
  return {
    description: '',
    hsn_sac: '',
    quantity: '1',
    unit: 'NOS',
    rate: '',
    discount_percent: '0',
    gst_rate: '18',
    cess_rate: '0',
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

  return {
    client: {
      name: '',
      gstin: '',
      email: '',
      phone: '',
      address_line1: '',
      address_line2: '',
      city: '',
      state_code: business?.state_code ?? '',
      pincode: '',
      country: 'India',
    },
    issue_date: today,
    due_date: '',
    // Defaulting the place of supply to the supplier's own state makes the
    // common case (a local client) correct with no input, and the field is right
    // there to change when it isn't.
    place_of_supply_state_code: business?.state_code ?? '',
    is_export: false,
    reverse_charge: false,
    currency: 'INR',
    notes: business?.default_notes ?? '',
    terms: business?.default_terms ?? '',
    items: [emptyLineItem()],
  }
}

/** Translate form values into the tax engine's input. */
export function toGstInput(
  values: InvoiceFormValues,
  business: BusinessRow | null,
): GstInvoiceInput {
  return {
    supplierStateCode: business?.state_code ?? '',
    placeOfSupplyStateCode: values.place_of_supply_state_code,
    supplierIsGstRegistered: business?.is_gst_registered ?? false,
    isExport: values.is_export,
    reverseCharge: values.reverse_charge,
    lines: values.items.map((item) => ({
      description: item.description,
      hsnSac: item.hsn_sac || undefined,
      quantity: num(item.quantity),
      unit: item.unit,
      rate: num(item.rate),
      discountPercent: num(item.discount_percent),
      gstRate: num(item.gst_rate),
      cessRate: num(item.cess_rate),
    })),
  }
}

/** Translate form values into the server action's payload. */
export function toSavePayload(values: InvoiceFormValues) {
  return {
    client: { ...values.client },
    issue_date: values.issue_date,
    due_date: values.due_date,
    place_of_supply_state_code: values.place_of_supply_state_code,
    is_export: values.is_export,
    reverse_charge: values.reverse_charge,
    currency: values.currency,
    notes: values.notes,
    terms: values.terms,
    items: values.items.map((item) => ({
      description: item.description,
      hsn_sac: item.hsn_sac,
      quantity: num(item.quantity),
      // The select can only produce a valid UQC, and the server re-validates
      // with z.enum(UNITS) regardless, so narrowing here is safe.
      unit: item.unit as Unit,
      rate: num(item.rate),
      discount_percent: num(item.discount_percent),
      gst_rate: num(item.gst_rate),
      cess_rate: num(item.cess_rate),
    })),
  }
}
