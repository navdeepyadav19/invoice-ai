import { z } from 'zod'

import { isCountryCode } from './locale/countries'
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

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe what you are billing for'),
  quantity: z.coerce.number().gt(0, 'Quantity must be more than zero'),
  unit: z.enum(UNITS).default('NOS'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  tax_rate: z.coerce.number().min(0).max(100).default(0),
})

export const invoiceSchema = z.object({
  client: clientSchema,
  issue_date: z.iso.date(),
  due_date: z.union([z.iso.date(), z.literal('')]).optional(),
  currency: z.string().trim().toUpperCase().length(3).default('USD'),
  notes: optionalTrimmed,
  terms: optionalTrimmed,
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
})

export type InvoiceInput = z.infer<typeof invoiceSchema>
