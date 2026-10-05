import { z } from 'zod'

import { UNITS } from '@/lib/units'

/**
 * Tool input schemas, written for a model to read.
 *
 * They mirror the REST request bodies (lib/validators.ts) field for field, but
 * they're plain — no transforms — because the SDK turns them into the JSON
 * Schema a client shows the model, and transforms don't survive that trip.
 * The `.describe()` text is the model's documentation: units, formats, where
 * to find an id.
 *
 * They are not the validation of record. Each tool hands its arguments to the
 * same operation REST uses (lib/operations), which validates them with the
 * REST schema — so an MCP call and an API call are accepted and rejected by
 * exactly the same rules, with the same messages.
 */

export const invoiceId = z.string().min(1).describe('The invoice id, e.g. in_Pb2Xk7Mv4Qs9Lr1Wd6Tn3Fh8 (from list_invoices or create_invoice_draft).')

export const customerId = z.string().min(1).describe('The customer id, e.g. cus_Nf3kQ8pR2mX7vB1cT9wL4sZ6 (from search_customers).')

export const limit = z.number().int().min(1).max(50).optional().describe('How many results to return (1–50, default 10).')

export const cursor = z.string().optional().describe('The next_cursor from a previous page, to fetch the next one.')

export const confirmationToken = z
  .string()
  .optional()
  .describe(
    'Leave this out on the first call: you get a preview and a token. Show the preview to the user, and only after they say yes, call again with the token.',
  )

const address = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().length(2).optional().describe('ISO 3166-1 alpha-2, e.g. US, GB, IN.'),
  })
  .describe('Billing address.')

export const customerFields = {
  name: z.string().min(1).describe('The customer or company name, as it should appear on invoices.'),
  email: z.string().optional().describe('Where invoices are emailed. Ask the user rather than guessing.'),
  phone: z.string().optional(),
  tax_id: z.string().optional().describe('VAT, GST, EIN or similar, as free text.'),
  address: address.optional(),
}

const line = z.object({
  description: z.string().optional().describe('What was sold, e.g. "Design retainer — October".'),
  quantity: z.number().gt(0).optional().describe('Defaults to 1.'),
  unit_amount: z
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      'Price per unit in the minor unit of the invoice currency, before tax: 150000 = $1,500.00 in USD. Currencies without a minor unit (JPY) use whole units.',
    ),
  tax_rate: z
    .number()
    .min(0)
    .max(100)
    .optional()
    .describe('Tax percent for this line, e.g. 18. Never guess a rate; ask the user if they did not say.'),
  discount_percent: z.number().min(0).max(100).optional(),
  unit: z.enum(UNITS).optional(),
  price: z.string().optional().describe('A catalog price id (price_…) from list_prices, instead of description + unit_amount.'),
})

export const invoiceFields = {
  currency: z
    .string()
    .length(3)
    .optional()
    .describe('ISO 4217 code, e.g. USD. Defaults to the business currency (see get_business_profile).'),
  due_date: z.string().optional().describe('YYYY-MM-DD.'),
  days_until_due: z.number().int().min(0).max(365).optional().describe('Alternative to due_date.'),
  description: z.string().optional().describe('A note shown on the invoice.'),
  footer: z.string().optional().describe('Terms shown at the bottom of the invoice.'),
  items: z.array(line).min(1).describe('The invoice lines. At least one.'),
}
