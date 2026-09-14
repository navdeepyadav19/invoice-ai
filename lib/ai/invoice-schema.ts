import { z } from 'zod'

import { GST_RATES, UNITS } from '@/lib/india'

/**
 * What the model is allowed to return when parsing "invoice ₹10,000 to Sharma
 * Traders for consulting".
 *
 * Every optional field is `.nullable()`, never `.optional()`. OpenAI's
 * structured-output mode requires every property to be present in the response,
 * so an optional field makes the whole generation fail rather than come back
 * without it.
 */

export const aiLineItemSchema = z.object({
  description: z.string().describe('What is being billed, in the user\'s own words'),
  quantity: z.number().describe('How many. Default to 1 when unstated.'),
  unit: z
    .string()
    .describe(`Unit of measure. One of: ${UNITS.join(', ')}. Default NOS.`),
  rate: z
    .number()
    .describe('Price per unit in rupees, as a number. No currency symbol, no commas.'),
  gst_rate: z
    .number()
    .describe(`GST percentage. One of: ${GST_RATES.join(', ')}. Default 18 for services.`),
  hsn_sac: z.string().nullable().describe('HSN or SAC code if the user gave one, else null'),
})

export const aiInvoiceSchema = z.object({
  client_name: z.string().nullable().describe('Who is being billed'),
  client_gstin: z.string().nullable().describe('Client GSTIN if spoken, else null'),
  client_city: z.string().nullable().describe('Client city if mentioned, else null'),
  client_email: z.string().nullable().describe('Client email if mentioned, else null'),
  place_of_supply_state_name: z
    .string()
    .nullable()
    .describe('Indian state the supply is made to, if stated. Full name, e.g. "Karnataka".'),
  due_in_days: z
    .number()
    .nullable()
    .describe('Payment terms in days if stated, e.g. "net 30" -> 30. Else null.'),
  notes: z.string().nullable().describe('Any note for the invoice, else null'),
  amount_is_tax_inclusive: z
    .boolean()
    .describe(
      'True only if the user said the amount already includes GST ("inclusive of tax", "all in").',
    ),
  items: z.array(aiLineItemSchema).describe('One entry per thing being billed'),
})

export type AiInvoiceDraft = z.infer<typeof aiInvoiceSchema>

/**
 * The system prompt.
 *
 * The specifics here are what stop the common failure modes: Indian numbering
 * ("2.5 lakh" is 250000, not 2.5), rupee symbols and commas inside numbers, and
 * the model inventing a client or an amount when the user didn't give one.
 */
export const AI_INVOICE_SYSTEM_PROMPT = `You turn a short spoken or typed instruction into the fields of an Indian GST invoice.

Rules:
- Amounts are in Indian rupees. Strip "₹", "Rs", "INR" and thousands separators. Return plain numbers.
- Understand Indian numbering: "10k" = 10000, "2 lakh" / "2L" = 200000, "1.5 crore" = 15000000.
- "rate" is the price PER UNIT. If the user gives a total for several units, divide.
- Set amount_is_tax_inclusive true ONLY if they explicitly say the figure includes GST.
- Default gst_rate to 18 (the common services slab) unless the user names a rate or the item is obviously another slab.
- Default quantity to 1 and unit to "NOS" when unstated.
- NEVER invent a client name, an amount, or a GSTIN. If the user didn't say it, return null.
- If the user describes several things, return several items.
- Keep the description close to the user's own wording; do not embellish it.`
