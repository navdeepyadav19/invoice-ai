import { z } from 'zod'

import { isCountryCode } from './locale/countries'
import { wireMinorToMajor } from './money-api'
import { UNITS } from './units'

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(isCountryCode, { message: 'Pick a country' })

/**
 * Business profile collected at onboarding and in settings.
 * Country and currency are required; tax ID is optional free text
 * (VAT / EIN / GSTIN / ABN — no format check).
 */
export const businessSchema = z.object({
  legal_name: z.string().trim().min(2, 'Enter your business name'),
  trade_name: optionalTrimmed,
  country_code: countryCodeSchema,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .length(3, 'Pick a currency')
    .regex(/^[A-Z]{3}$/, 'Pick a currency'),
  tax_id: optionalTrimmed,
  address_line1: z.string().trim().min(3, 'Enter your address'),
  address_line2: optionalTrimmed,
  city: z.string().trim().min(2, 'Enter your city'),
  region: optionalTrimmed,
  postal_code: optionalTrimmed,
  email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
  phone: optionalTrimmed,
  business_type: z.enum(['sole_trader', 'partnership', 'limited_company', 'other']).optional(),
})

export type BusinessInput = z.infer<typeof businessSchema>

export const paymentDetailsSchema = z.object({
  bank_name: optionalTrimmed,
  account_name: optionalTrimmed,
  account_number: optionalTrimmed,
  routing_number: optionalTrimmed,
  default_terms: optionalTrimmed,
  default_notes: optionalTrimmed,
})

export type PaymentDetailsInput = z.infer<typeof paymentDetailsSchema>

export const numberingSchema = z.object({
  invoice_prefix: z
    .string()
    .trim()
    .toUpperCase()
    .min(1, 'Enter a prefix')
    .max(16, 'Keep the prefix to 16 characters')
    .regex(/^[A-Z0-9\-/]+$/, 'Letters, numbers, hyphens and slashes only'),
  next_invoice_number: z.coerce
    .number()
    .int('Use a whole number')
    .min(1, 'Start at 1 or higher')
    .max(999999, 'That is too large'),
})

export type NumberingInput = z.infer<typeof numberingSchema>

export const clientSchema = z.object({
  name: z.string().trim().min(2, "Enter your client's name"),
  tax_id: optionalTrimmed,
  email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
  phone: optionalTrimmed,
  address_line1: optionalTrimmed,
  address_line2: optionalTrimmed,
  city: optionalTrimmed,
  region: optionalTrimmed,
  postal_code: optionalTrimmed,
  country_code: z.union([countryCodeSchema, z.literal('')]).optional(),
  country: optionalTrimmed,
})

export type ClientInput = z.infer<typeof clientSchema>

/**
 * A blank client in the schema's output shape.
 *
 * Needed because `optionalTrimmed` (`.optional().transform(…)`) infers keys as
 * required-but-possibly-`undefined` — a bare `{ name }` does not satisfy the
 * type, so every place that builds a client from scratch uses this.
 */
export function emptyClientInput(name = ''): ClientInput {
  return {
    name,
    tax_id: undefined,
    phone: undefined,
    address_line1: undefined,
    address_line2: undefined,
    city: undefined,
    region: undefined,
    postal_code: undefined,
    country: undefined,
  }
}

export const lineItemSchema = z
  .object({
    description: z.string().trim().default(''),
    quantity: z.coerce.number().gt(0, 'Quantity must be more than zero').default(1),
    unit: z.enum(UNITS).default('NOS'),
    /** Omitted on priced lines — borrowed from the price. Required ad-hoc. */
    rate: z.coerce.number().min(0, 'Rate cannot be negative').optional(),
    discount_percent: z.coerce.number().min(0).max(100).default(0),
    /** Omitted on priced lines — borrowed from the price. Defaults to 0 ad-hoc. */
    tax_rate: z.coerce.number().min(0).max(100).optional(),
    /**
     * A catalog price (`price_…` or UUID). When present, a missing
     * description/rate/tax_rate is borrowed from the price's product name,
     * unit amount and tax rate. The price currency must match the invoice
     * currency.
     */
    price: z.string().trim().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.price) return
    // An ad-hoc line has nothing to borrow from, so it must stand alone.
    if (!value.description.trim()) {
      ctx.addIssue({
        code: 'custom',
        path: ['description'],
        message: 'Describe what you are billing for',
      })
    }
    if (value.rate === undefined) {
      ctx.addIssue({ code: 'custom', path: ['rate'], message: 'Enter a rate' })
    }
  })

export const invoiceSchema = z.object({
  client: clientSchema,
  issue_date: z.iso.date(),
  due_date: z.union([z.iso.date(), z.literal('')]).optional(),
  /** Omitted → the business default currency. The API wire layer fills USD only as a last resort. */
  currency: z.string().trim().toUpperCase().length(3).optional(),
  collection_method: z.enum(['charge_automatically', 'send_invoice']).default('send_invoice'),
  notes: optionalTrimmed,
  terms: optionalTrimmed,
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
})

export type InvoiceInput = z.infer<typeof invoiceSchema>

/**
 * Products & Prices — the Stripe-style catalog.
 *
 * A Product names something you sell. A Price is one way to charge for it:
 * an amount in a currency, one-off or recurring (interval + count).
 * Recurring is a data model only in this phase — nothing auto-bills yet.
 */

/**
 * Update schemas are NOT `createSchema.partial()`.
 *
 * `.partial()` makes a key optional but keeps its `.default()`, so an omitted
 * key is filled with the create-time default: a PATCH of `{ nickname }` would
 * come out as `{ nickname, type: 'one_time', active: true, … }` and silently
 * turn a recurring price into a one-off (or un-archive a product, or wipe its
 * images). Each resource therefore declares its fields once WITHOUT defaults;
 * the create schema layers the defaults on, the update schema makes the plain
 * fields partial. Omitted means "leave it alone".
 *
 * Updates also accept `null` / `""` on clearable text so a description or
 * nickname can actually be removed (`optionalTrimmed` turns "" into "not
 * sent", which is right on create and wrong on update).
 */
const clearableTrimmed = z
  .string()
  .trim()
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v))

const productFields = {
  name: z.string().trim().min(1, 'Name your product').max(200),
  description: optionalTrimmed,
  images: z.array(z.string().trim().url('Enter a valid image URL')).max(8),
  active: z.boolean(),
}

export const productSchema = z.object({
  ...productFields,
  images: productFields.images.default([]),
  active: productFields.active.default(true),
})

export type ProductInput = z.infer<typeof productSchema>

/** PATCH a product: omitted fields are left untouched (no defaults). */
export const productUpdateSchema = z
  .object({ ...productFields, description: clearableTrimmed })
  .partial()

export type ProductUpdateInput = z.input<typeof productUpdateSchema>

export const RECURRING_INTERVALS = ['day', 'week', 'month', 'year'] as const

const currencyField = z
  .string()
  .trim()
  .toUpperCase()
  .length(3, 'Pick a currency')
  .regex(/^[A-Z]{3}$/, 'Pick a currency')

const priceFields = {
  /** The parent product: UUID or `prod_…` public ID. */
  product: z.string().trim().min(1, 'Pick a product'),
  nickname: optionalTrimmed,
  unit_amount: z.coerce.number().min(0, 'Amount cannot be negative'),
  currency: currencyField,
  type: z.enum(['one_time', 'recurring']),
  recurring_interval: z.enum(RECURRING_INTERVALS).optional(),
  interval_count: z.coerce.number().int().min(1).max(52),
  tax_rate: z.coerce.number().min(0).max(100),
  active: z.boolean(),
}

/**
 * PATCH a price: omitted fields are left untouched. The one_time/recurring
 * consistency check needs the stored row, so the service adds it.
 */
export const priceUpdateSchema = z
  .object({ ...priceFields, nickname: clearableTrimmed })
  .partial()

export type PriceUpdateInput = z.input<typeof priceUpdateSchema>

export const priceSchema = z
  .object({
    ...priceFields,
    type: priceFields.type.default('one_time'),
    interval_count: priceFields.interval_count.default(1),
    tax_rate: priceFields.tax_rate.default(0),
    active: priceFields.active.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.type === 'recurring' && !value.recurring_interval) {
      ctx.addIssue({
        code: 'custom',
        path: ['recurring_interval'],
        message: 'Pick how often this price recurs',
      })
    }
    if (value.type === 'one_time' && value.recurring_interval) {
      ctx.addIssue({
        code: 'custom',
        path: ['recurring_interval'],
        message: 'One-off prices do not recur',
      })
    }
  })

export type PriceInput = z.infer<typeof priceSchema>

/**
 * Stripe-shaped wire schemas for the REST API.
 *
 * Same resource and field names as Stripe (`customer`, `unit_amount`,
 * `recurring: { interval }`), adapted to this API's conventions: ISO dates
 * (not Unix timestamps), JSON only, `{ data }` envelope, minor-unit integers
 * for money. Routes convert these to the internal schemas above.
 */

const addressWireSchema = z.object({
  line1: optionalTrimmed,
  line2: optionalTrimmed,
  city: optionalTrimmed,
  state: optionalTrimmed,
  postal_code: optionalTrimmed,
  country: z.string().trim().toUpperCase().length(2).optional(),
})

export const customerWireSchema = z.object({
  name: z.string().trim().min(1, "Enter your customer's name"),
  email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
  phone: optionalTrimmed,
  tax_id: optionalTrimmed,
  address: addressWireSchema.optional(),
})

export type CustomerWireInput = z.infer<typeof customerWireSchema>

export function customerWireToClient(input: CustomerWireInput): ClientInput {
  return {
    name: input.name,
    email: input.email,
    phone: input.phone,
    tax_id: input.tax_id,
    address_line1: input.address?.line1,
    address_line2: input.address?.line2,
    city: input.address?.city,
    region: input.address?.state,
    postal_code: input.address?.postal_code,
    country_code: input.address?.country,
    country: input.address?.country,
  }
}

export function customerWirePartialToClient(
  input: Partial<CustomerWireInput>,
): Partial<ClientInput> {
  const out: Partial<ClientInput> = {}
  if (input.name !== undefined) out.name = input.name
  if (input.email !== undefined) out.email = input.email
  if (input.phone !== undefined) out.phone = input.phone
  if (input.tax_id !== undefined) out.tax_id = input.tax_id
  if (input.address?.line1 !== undefined) out.address_line1 = input.address.line1
  if (input.address?.line2 !== undefined) out.address_line2 = input.address.line2
  if (input.address?.city !== undefined) out.city = input.address.city
  if (input.address?.state !== undefined) out.region = input.address.state
  if (input.address?.postal_code !== undefined) out.postal_code = input.address.postal_code
  if (input.address?.country !== undefined) {
    out.country_code = input.address.country
    out.country = input.address.country
  }
  return out
}

const recurringWireSchema = z.object({
  interval: z.enum(RECURRING_INTERVALS),
  interval_count: z.coerce.number().int().min(1).max(52).default(1),
})

const priceWireFields = {
  product: z.string().trim().min(1, 'Pick a product'),
  nickname: optionalTrimmed,
  /** Minor units of `currency`, like Stripe: 5000 is $50.00, or ¥5,000. */
  unit_amount: z.coerce.number().int('Use whole minor units').min(0, 'Amount cannot be negative'),
  currency: currencyField,
  type: z.enum(['one_time', 'recurring']),
  recurring: recurringWireSchema.optional(),
  tax_rate: z.coerce.number().min(0).max(100),
  active: z.boolean(),
}

export const priceWireSchema = z.object({
  ...priceWireFields,
  type: priceWireFields.type.default('one_time'),
  tax_rate: priceWireFields.tax_rate.default(0),
  active: priceWireFields.active.default(true),
})

export type PriceWireInput = z.infer<typeof priceWireSchema>

/** PATCH /v1/prices/{id}: omitted fields are left untouched (see productUpdateSchema). */
export const priceWireUpdateSchema = z
  .object({ ...priceWireFields, nickname: clearableTrimmed })
  .partial()

export type PriceWireUpdateInput = z.infer<typeof priceWireUpdateSchema>

export function priceWireToInput(input: PriceWireInput): PriceInput {
  return {
    product: input.product,
    nickname: input.nickname,
    unit_amount: wireMinorToMajor(input.unit_amount, input.currency, 'unit_amount'),
    currency: input.currency,
    type: input.type,
    recurring_interval: input.recurring?.interval,
    interval_count: input.recurring?.interval_count ?? 1,
    tax_rate: input.tax_rate,
    active: input.active,
  }
}

/**
 * `currency` is the price's currency after the update — the one sent, or the
 * stored one — so `unit_amount` is read in the right minor unit.
 */
export function priceWirePartialToInput(input: PriceWireUpdateInput, currency: string): PriceUpdateInput {
  const out: PriceUpdateInput = {}
  // null clears the nickname, like Stripe's `nickname: ""`.
  if (input.nickname !== undefined) out.nickname = input.nickname
  if (input.unit_amount !== undefined) {
    out.unit_amount = wireMinorToMajor(input.unit_amount, input.currency ?? currency, 'unit_amount')
  }
  if (input.currency !== undefined) out.currency = input.currency
  if (input.type !== undefined) out.type = input.type
  if (input.recurring !== undefined) {
    out.recurring_interval = input.recurring?.interval
    out.interval_count = input.recurring?.interval_count ?? 1
  }
  if (input.tax_rate !== undefined) out.tax_rate = input.tax_rate
  if (input.active !== undefined) out.active = input.active
  return out
}

const invoiceLineWireSchema = z.object({
  price: z.string().trim().optional(),
  description: z.string().trim().default(''),
  quantity: z.coerce.number().gt(0, 'Quantity must be more than zero').default(1),
  unit: z.enum(UNITS).default('NOS'),
  /** Minor units, like Stripe. Omitted on priced lines — borrowed from the price. */
  unit_amount: z.coerce.number().int('Use whole minor units').min(0).optional(),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  tax_rate: z.coerce.number().min(0).max(100).optional(),
})

/**
 * The invoice body. Every field is optional here because PATCH is a partial
 * update: omitted fields keep their stored value, and omitted `items` keep the
 * lines. Create adds its own requirement (`customer`) on top.
 */
export const invoiceWireSchema = z.object({
  /** An existing customer: `cus_…` or UUID. Required on create, like Stripe. */
  customer: z.string().trim().min(1, 'Pick a customer').optional(),
  currency: z.string().trim().toUpperCase().length(3).regex(/^[A-Z]{3}$/, 'Pick a currency').optional(),
  collection_method: z.enum(['charge_automatically', 'send_invoice']).optional(),
  due_date: z.union([z.iso.date(), z.literal('')]).optional(),
  days_until_due: z.coerce.number().int().min(0).max(365).optional(),
  description: optionalTrimmed,
  footer: optionalTrimmed,
  items: z.array(invoiceLineWireSchema).min(1, 'Add at least one line item').optional(),
})

export type InvoiceWireInput = z.infer<typeof invoiceWireSchema>

/** Create requires a customer; updates merge over the stored draft. */
export const invoiceCreateWireSchema = invoiceWireSchema.superRefine((value, ctx) => {
  if (!value.customer) {
    ctx.addIssue({ code: 'custom', path: ['customer'], message: 'Pick a customer' })
  }
})
