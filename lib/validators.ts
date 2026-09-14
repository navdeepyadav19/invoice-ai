import { z } from 'zod'

import { GST_RATES, GST_STATES, UNITS, isValidStateCode } from './india'

/**
 * A GSTIN is 15 characters: 2-digit state code, 10-character PAN, an entity
 * number, a literal 'Z', and a checksum character.
 *   27 AAPFU 0939 F 1 Z V
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** PAN: 5 letters, 4 digits, 1 letter. */
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/

/** IFSC: 4-letter bank code, a literal 0, then a 6-character branch code. */
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/

/** UPI VPA: name@handle. */
export const UPI_REGEX = /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/

export const PINCODE_REGEX = /^[1-9][0-9]{5}$/

/**
 * The GSTIN checksum: characters are scored against a 36-character alphabet,
 * weighted alternately 1 and 2, and the remainder must produce the final digit.
 * Worth doing because a transposed digit passes the regex but fails here, and a
 * wrong GSTIN on an issued invoice is a correction the merchant has to chase.
 */
export function hasValidGstinChecksum(gstin: string): boolean {
  if (!GSTIN_REGEX.test(gstin)) return false

  const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  let sum = 0

  for (let i = 0; i < 14; i++) {
    const value = alphabet.indexOf(gstin[i])
    if (value < 0) return false
    const weighted = value * (i % 2 === 0 ? 1 : 2)
    sum += Math.floor(weighted / 36) + (weighted % 36)
  }

  const checksum = alphabet[(36 - (sum % 36)) % 36]
  return checksum === gstin[14]
}

/** The state a GSTIN is registered in, taken from its first two digits. */
export function stateCodeFromGstin(gstin: string): string | null {
  if (gstin.length < 2) return null
  const code = gstin.slice(0, 2)
  return isValidStateCode(code) ? code : null
}

const stateCodeSchema = z
  .string()
  .refine(isValidStateCode, { message: 'Pick a valid state' })

const optionalTrimmed = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(GSTIN_REGEX, 'A GSTIN is 15 characters, like 27AAPFU0939F1ZV')
  .refine(hasValidGstinChecksum, 'That GSTIN fails its checksum — check for a typo')

export const panSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(PAN_REGEX, 'A PAN is 10 characters, like AAPFU0939F')

/**
 * Business profile, collected in onboarding step 1 and editable in settings.
 *
 * The cross-field rule is the interesting part: if you claim GST registration
 * the GSTIN becomes required AND its embedded state must agree with the state
 * you selected. A Maharashtra GSTIN on a Karnataka address would silently
 * produce the wrong CGST/SGST-vs-IGST split on every invoice you ever raise.
 */
export const businessSchema = z
  .object({
    legal_name: z.string().trim().min(2, 'Enter the name that appears on your PAN'),
    trade_name: optionalTrimmed,
    is_gst_registered: z.boolean(),
    gstin: z.union([gstinSchema, z.literal('')]).optional(),
    pan: z.union([panSchema, z.literal('')]).optional(),
    address_line1: z.string().trim().min(3, 'Enter your address'),
    address_line2: optionalTrimmed,
    city: z.string().trim().min(2, 'Enter your city'),
    state_code: stateCodeSchema,
    pincode: z
      .union([z.string().trim().regex(PINCODE_REGEX, 'Enter a 6-digit PIN code'), z.literal('')])
      .optional(),
    country: z.string().trim().default('India'),
    email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
    phone: optionalTrimmed,
    // Derived from the GST registry's constitution field when a GSTIN was
    // looked up, chosen by the user only when it wasn't.
    business_type: z
      .enum(['sole_trader', 'partnership', 'limited_company', 'other'])
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.is_gst_registered) return

    if (!value.gstin) {
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: 'Enter your GSTIN, or turn off GST registration',
      })
      return
    }

    const gstinState = stateCodeFromGstin(value.gstin)
    if (gstinState && gstinState !== value.state_code) {
      const expected = GST_STATES.find((s) => s.code === gstinState)?.name ?? gstinState
      ctx.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `This GSTIN is registered in ${expected}, which doesn't match the state you selected`,
      })
    }
  })

export type BusinessInput = z.infer<typeof businessSchema>

export const paymentDetailsSchema = z.object({
  bank_name: optionalTrimmed,
  account_name: optionalTrimmed,
  account_number: optionalTrimmed,
  ifsc: z
    .union([z.string().trim().toUpperCase().regex(IFSC_REGEX, 'Enter a valid IFSC, like HDFC0001234'), z.literal('')])
    .optional(),
  upi_id: z.union([z.string().trim().regex(UPI_REGEX, 'Enter a valid UPI ID'), z.literal('')]).optional(),
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
    .max(10, 'Keep the prefix under 10 characters')
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
  gstin: z.union([gstinSchema, z.literal('')]).optional(),
  email: z.union([z.email('Enter a valid email'), z.literal('')]).optional(),
  phone: optionalTrimmed,
  address_line1: optionalTrimmed,
  address_line2: optionalTrimmed,
  city: optionalTrimmed,
  state_code: z.union([stateCodeSchema, z.literal('')]).optional(),
  pincode: z
    .union([z.string().trim().regex(PINCODE_REGEX, 'Enter a 6-digit PIN code'), z.literal('')])
    .optional(),
  country: z.string().trim().default('India'),
})

export type ClientInput = z.infer<typeof clientSchema>

export const lineItemSchema = z.object({
  description: z.string().trim().min(1, 'Describe what you are billing for'),
  hsn_sac: z
    .union([z.string().trim().regex(/^[0-9]{4,8}$/, 'HSN/SAC is 4 to 8 digits'), z.literal('')])
    .optional(),
  quantity: z.coerce.number().gt(0, 'Quantity must be more than zero'),
  unit: z.enum(UNITS).default('NOS'),
  rate: z.coerce.number().min(0, 'Rate cannot be negative'),
  discount_percent: z.coerce.number().min(0).max(100).default(0),
  gst_rate: z.coerce.number().refine((r) => (GST_RATES as readonly number[]).includes(r), 'Pick a GST slab'),
  cess_rate: z.coerce.number().min(0).max(100).default(0),
})

export const invoiceSchema = z.object({
  client: clientSchema,
  issue_date: z.iso.date(),
  due_date: z.union([z.iso.date(), z.literal('')]).optional(),
  place_of_supply_state_code: stateCodeSchema,
  is_export: z.boolean().default(false),
  reverse_charge: z.boolean().default(false),
  currency: z.string().trim().length(3).default('INR'),
  notes: optionalTrimmed,
  terms: optionalTrimmed,
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
})

export type InvoiceInput = z.infer<typeof invoiceSchema>
