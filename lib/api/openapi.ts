import * as z from 'zod'
import { createDocument } from 'zod-openapi'

import { SCOPES, SCOPE_DESCRIPTIONS } from '@/lib/auth/scopes'
import {
  customerWireSchema,
  invoiceWireSchema,
  priceWireSchema,
  productSchema,
} from '@/lib/validators'

/**
 * One source of truth for the contract.
 *
 * The same zod schemas that validate a request at runtime describe it here, so
 * the documentation cannot drift from the behaviour. A hand-written spec is a
 * second implementation of the contract, and the two disagree the first time
 * someone adds a field to only one of them.
 *
 *   lib/validators.ts  ──►  request validation (runtime)
 *          │
 *          └────────────►  this document  ──►  GET /api/v1/openapi.json
 *                                          └►  the Postman collection
 *
 * Resource and field names follow Stripe (`customer`, `unit_amount`,
 * `recurring.interval`, `cus_…` / `prod_…` / `price_…` / `in_…` / `ii_…` ids).
 * Money is integer minor units throughout — see lib/money-api.ts for why the
 * wire contract must not carry decimals.
 */

const minor = z
  .number()
  .int()
  .meta({ description: 'Amount in minor units. 250000 is $2,500.', examples: [250000] })

const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string().meta({ description: 'The X-Request-Id, for correlating with our logs.' }),
    code: z.string().meta({ description: 'Stable machine-readable code. Branch on this, not on detail.' }),
    errors: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  })
  .meta({ id: 'Problem' })

const addressSchema = z.object({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postal_code: z.string().nullable(),
  country: z.string().nullable(),
})

const customerOut = z
  .object({
    id: z.string().meta({ description: 'Public id: `cus_…`.', examples: ['cus_abc'] }),
    object: z.literal('customer'),
    name: z.string(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    tax_id: z.string().nullable(),
    address: addressSchema,
    deleted: z.boolean(),
    created: z.string(),
  })
  .meta({ id: 'Customer' })

const productOut = z
  .object({
    id: z.string().meta({ description: 'Public id: `prod_…`.' }),
    object: z.literal('product'),
    name: z.string(),
    description: z.string().nullable(),
    images: z.array(z.string()),
    active: z.boolean(),
    created: z.string(),
    updated: z.string(),
  })
  .meta({ id: 'Product' })

const priceOut = z
  .object({
    id: z.string().meta({ description: 'Public id: `price_…`.' }),
    object: z.literal('price'),
    product: z.string().nullable().meta({ description: 'The parent `prod_…` id.' }),
    nickname: z.string().nullable(),
    unit_amount: minor,
    currency: z.string(),
    billing_scheme: z.literal('per_unit'),
    type: z.enum(['one_time', 'recurring']),
    recurring: z
      .object({ interval: z.string().nullable(), interval_count: z.number().int() })
      .nullable(),
    tax_rate: z.number(),
    active: z.boolean(),
    created: z.string(),
  })
  .meta({ id: 'Price' })

const lineItemOut = z
  .object({
    id: z.string().meta({ description: 'Public id: `ii_…`.' }),
    object: z.literal('invoiceitem'),
    price: z.string().nullable().meta({ description: 'The `price_…` this line was billed from, if any.' }),
    product: z.string().nullable(),
    description: z.string(),
    quantity: z.number(),
    unit: z.string(),
    unit_amount: minor,
    amount: minor,
    discount_percent: z.number(),
    tax_rate: z.number().meta({ description: 'Tax percentage, exclusive.' }),
    tax_amount: minor,
  })
  .meta({ id: 'InvoiceItem' })

const invoiceOut = z
  .object({
    id: z.string().meta({ description: 'Public id: `in_…`.' }),
    object: z.literal('invoice'),
    number: z
      .string()
      .nullable()
      .meta({ description: 'Null until finalized. A draft has no number because none was spent on it.' }),
    status: z
      .enum(['draft', 'open', 'paid', 'overdue', 'void'])
      .meta({ description: '`overdue` is derived from due_date at read time and is never stored.' }),
    customer: z.string().nullable().meta({ description: 'The `cus_…` id.' }),
    currency: z.string(),
    collection_method: z.enum(['charge_automatically', 'send_invoice']),
    issue_date: z.string(),
    due_date: z.string().nullable(),
    description: z.string().nullable(),
    footer: z.string().nullable(),
    subtotal: minor,
    discount: minor,
    taxable: minor,
    tax: minor,
    total: minor,
    amount_due: minor.meta({ description: 'Still owed. Zero unless open or overdue.' }),
    amount_in_words: z.string().nullable(),
    public_url_token: z.string(),
    finalized_at: z.string().nullable(),
    paid_at: z.string().nullable(),
    voided_at: z.string().nullable(),
    void_reason: z.string().nullable(),
    created: z.string(),
    updated: z.string(),
    lines: z.object({ data: z.array(lineItemOut) }).optional(),
  })
  .meta({ id: 'Invoice' })

const eventOut = z
  .object({
    id: z.string(),
    type: z.string().meta({
      description: 'invoice.created | invoice.finalized | invoice.paid | invoice.voided | …',
    }),
    meta: z.record(z.string(), z.unknown()).nullable(),
    created_at: z.string(),
  })
  .meta({ id: 'InvoiceEvent' })

const webhookEndpointOut = z
  .object({
    id: z.string(),
    url: z.string(),
    events: z.array(z.string()),
    active: z.boolean(),
    disabled_at: z.string().nullable(),
    failure_count: z.number().int(),
    created_at: z.string(),
  })
  .meta({ id: 'WebhookEndpoint' })

const problemResponse = (description: string) => ({
  description,
  content: { 'application/problem+json': { schema: problemSchema } },
})

/** Every endpoint can produce these, so they're declared once. */
const commonErrors = {
  '401': problemResponse('Missing, malformed, revoked or expired API key.'),
  '403': problemResponse('The key is valid but lacks the required scope.'),
  '429': problemResponse('Rate limit exceeded. See Retry-After.'),
}

// Names and locations come from the object keys below — zod-openapi derives
// them from `requestParams`, and supplying them again in .meta({ param }) is a
// conflict it rejects at build time.
const cursorParams = z.object({
  cursor: z.string().optional().meta({ description: 'Opaque. Pass back next_cursor.' }),
  limit: z.number().int().optional().meta({ description: 'Max 100. Defaults to 25.' }),
})

export function buildOpenApiDocument(serverUrl: string) {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Invoice-AI API',
      version: '2.0.0',
      description: [
        'Global invoicing over HTTP, Stripe-shaped.',
        '',
        'Resources and fields follow Stripe (`customers`, `products`, `prices`,',
        '`invoices`, `invoice-items`; `unit_amount` minor units; `cus_…`,',
        '`prod_…`, `price_…`, `in_…`, `ii_…` ids) while keeping this API\'s',
        'conventions: JSON bodies, a `{ data }` envelope, Bearer API keys,',
        'cursor pagination (`next_cursor`), and RFC 9457 errors.',
        '',
        '## Authentication',
        'Send your API key as `Authorization: Bearer inv_live_…`. Keys are created in',
        'Settings → API keys and shown once. Key management is deliberately not available',
        'through this API, so a leaked key cannot mint more keys.',
        '',
        '## Money',
        'All amounts are integer **minor units** (`250000` is $2,500). JSON numbers are IEEE',
        'doubles, so a contract carrying decimals would eventually disagree with',
        'itself about a total.',
        '',
        '## Tax',
        'Each line carries a free-form `tax_rate` percentage. Country presets are',
        'invoicing defaults, not a compliance engine.',
        '',
        '## Idempotency',
        'Write endpoints that spend an invoice number require an `Idempotency-Key` header',
        'and return `428` without one. Retrying with the same key replays the first',
        'response and sets `Idempotent-Replayed: true`. Reusing a key with a *different*',
        'body is a `422` — that is almost always a key generated outside a retry loop.',
        '',
        '## Errors',
        'Every error is RFC 9457 `application/problem+json`. Branch on `code`, never on',
        '`detail`. Another owner’s resource returns `404`, not `403`, so ids cannot be',
        'enumerated by probing.',
      ].join('\n'),
    },
    servers: [{ url: serverUrl }],
    tags: [
      { name: 'Business' },
      { name: 'Customers' },
      { name: 'Products' },
      { name: 'Prices' },
      { name: 'Invoices' },
      { name: 'InvoiceItems' },
      { name: 'Webhooks' },
    ],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'An Invoice-AI API key: `inv_live_<id>_<secret>`.',
        },
      },
    },
    security: [{ apiKey: [] }],
    paths: {
      '/business': {
        get: {
          tags: ['Business'],
          summary: 'Read the business profile',
          description: `Requires the \`business:read\` scope. ${SCOPE_DESCRIPTIONS['business:read']}.`,
          responses: {
            '200': {
              description: 'The primary business.',
              content: { 'application/json': { schema: z.object({ data: z.unknown() }) } },
            },
            '404': problemResponse('No business profile yet — onboarding is unfinished.'),
            ...commonErrors,
          },
        },
      },

      '/customers': {
        get: {
          tags: ['Customers'],
          summary: 'List customers',
          requestParams: {
            query: cursorParams.extend({
              query: z.string().optional().meta({ description: 'Case-insensitive name match.' }),
              include_deleted: z.boolean().optional(),
            }),
          },
          responses: {
            '200': {
              description: 'A page of customers.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(customerOut), next_cursor: z.string().nullable() }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Customers'],
          summary: 'Create a customer',
          requestBody: { content: { 'application/json': { schema: customerWireSchema } } },
          responses: {
            '201': {
              description: 'Created.',
              content: { 'application/json': { schema: z.object({ data: customerOut }) } },
            },
            '422': problemResponse('Validation failed. See `errors[]`.'),
            ...commonErrors,
          },
        },
      },

      '/customers/{id}': {
        get: {
          tags: ['Customers'],
          summary: 'Read a customer',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The customer.',
              content: { 'application/json': { schema: z.object({ data: customerOut }) } },
            },
            '404': problemResponse('No such customer, or it belongs to another owner.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Customers'],
          summary: 'Update a customer',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: customerWireSchema.partial() } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: customerOut }) } },
            },
            '404': problemResponse('No such customer.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Customers'],
          summary: 'Delete a customer',
          description:
            'Archives rather than deletes: issued invoices reference customers and must keep naming who they were billed to.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Archived.',
              content: { 'application/json': { schema: z.object({ data: customerOut }) } },
            },
            ...commonErrors,
          },
        },
      },

      '/products': {
        get: {
          tags: ['Products'],
          summary: 'List products',
          requestParams: {
            query: cursorParams.extend({
              query: z.string().optional().meta({ description: 'Case-insensitive name match.' }),
              active: z.boolean().optional(),
            }),
          },
          responses: {
            '200': {
              description: 'A page of products.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(productOut), next_cursor: z.string().nullable() }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Products'],
          summary: 'Create a product',
          requestBody: { content: { 'application/json': { schema: productSchema } } },
          responses: {
            '201': {
              description: 'Created.',
              content: { 'application/json': { schema: z.object({ data: productOut }) } },
            },
            '422': problemResponse('Validation failed. See `errors[]`.'),
            ...commonErrors,
          },
        },
      },

      '/products/{id}': {
        get: {
          tags: ['Products'],
          summary: 'Read a product',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The product.',
              content: { 'application/json': { schema: z.object({ data: productOut }) } },
            },
            '404': problemResponse('No such product.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Products'],
          summary: 'Update a product',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: productSchema.partial() } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: productOut }) } },
            },
            '404': problemResponse('No such product.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Products'],
          summary: 'Archive a product',
          description: 'Prices and invoice lines may reference it, so the row stays with `active: false`.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Archived.',
              content: { 'application/json': { schema: z.object({ data: productOut }) } },
            },
            ...commonErrors,
          },
        },
      },

      '/prices': {
        get: {
          tags: ['Prices'],
          summary: 'List prices',
          requestParams: {
            query: cursorParams.extend({
              product: z.string().optional().meta({ description: '`prod_…` or UUID.' }),
              active: z.boolean().optional(),
              currency: z.string().optional(),
              type: z.enum(['one_time', 'recurring']).optional(),
            }),
          },
          responses: {
            '200': {
              description: 'A page of prices.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(priceOut), next_cursor: z.string().nullable() }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Prices'],
          summary: 'Create a price',
          description: '`unit_amount` is minor units. `recurring.interval` makes it a subscription-style price (stored; nothing auto-bills yet).',
          requestBody: { content: { 'application/json': { schema: priceWireSchema } } },
          responses: {
            '201': {
              description: 'Created.',
              content: { 'application/json': { schema: z.object({ data: priceOut }) } },
            },
            '422': problemResponse('Validation failed. See `errors[]`.'),
            ...commonErrors,
          },
        },
      },

      '/prices/{id}': {
        get: {
          tags: ['Prices'],
          summary: 'Read a price',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The price.',
              content: { 'application/json': { schema: z.object({ data: priceOut }) } },
            },
            '404': problemResponse('No such price.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Prices'],
          summary: 'Update a price',
          description: 'The parent product cannot change — create a new price instead.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: priceWireSchema.partial() } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: priceOut }) } },
            },
            '404': problemResponse('No such price.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Prices'],
          summary: 'Archive a price',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Archived.',
              content: { 'application/json': { schema: z.object({ data: priceOut }) } },
            },
            ...commonErrors,
          },
        },
      },

      '/invoices': {
        get: {
          tags: ['Invoices'],
          summary: 'List invoices',
          description:
            '`status=overdue` works even though no row is stored as overdue — it is computed from `due_date` at read time.',
          requestParams: {
            query: cursorParams.extend({
              status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).optional(),
              customer: z.string().optional().meta({ description: '`cus_…` or UUID.' }),
              from: z.string().optional().meta({ description: 'issue_date ≥' }),
              to: z.string().optional().meta({ description: 'issue_date ≤' }),
            }),
          },
          responses: {
            '200': {
              description: 'A page of invoices.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(invoiceOut), next_cursor: z.string().nullable() }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Invoices'],
          summary: 'Create a draft',
          description:
            'Requires an `Idempotency-Key`. A retried create would otherwise make a second identical draft with no way to tell which one to finalize.',
          requestBody: { content: { 'application/json': { schema: invoiceWireSchema } } },
          responses: {
            '201': {
              description: 'Draft created.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '422': problemResponse('Validation failed.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}': {
        get: {
          tags: ['Invoices'],
          summary: 'Read an invoice',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The invoice, with lines.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '404': problemResponse('No such invoice, or it belongs to another owner.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Invoices'],
          summary: 'Update a draft',
          description: 'Drafts only. A finalized invoice is frozen — the customer may already have the PDF.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: invoiceWireSchema } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('The invoice has been finalized and can no longer be edited.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Invoices'],
          summary: 'Delete a draft',
          description:
            'Drafts only. A finalized invoice holds a number in a consecutive series — void it instead.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '204': { description: 'Deleted.' },
            '409': problemResponse('The invoice has been finalized. Void it instead.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/finalize': {
        post: {
          tags: ['Invoices'],
          summary: 'Finalize a draft',
          description:
            'Assigns a permanent number and opens the invoice. Requires an `Idempotency-Key`; a retry replays the first response. Even without one, finalizing twice returns the same number.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Finalized.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('The invoice is not a draft, or has no line items.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/send': {
        post: {
          tags: ['Invoices'],
          summary: 'Email the invoice to the customer',
          description:
            'Finalizes it first if it has no number. Rate-limited to 10/hour — each call costs money and lands in a third party’s inbox.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  to: z.string().optional().meta({ description: 'Overrides the customer’s stored email.' }),
                }),
              },
            },
          },
          responses: {
            '200': {
              description: 'Sent.',
              content: {
                'application/json': {
                  schema: z.object({
                    data: z.object({
                      id: z.string(),
                      invoice_number: z.string(),
                      emailed: z.boolean(),
                      public_url: z.string(),
                    }),
                  }),
                },
              },
            },
            '502': problemResponse('The invoice was finalized but the email failed. The number is spent.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/pay': {
        post: {
          tags: ['Invoices'],
          summary: 'Mark an invoice paid',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  paid_on: z.string().optional(),
                  reference: z.string().optional().meta({ description: 'Payment reference.' }),
                }),
              },
            },
          },
          responses: {
            '200': {
              description: 'Marked paid.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('Only an open invoice can be marked paid.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/void': {
        post: {
          tags: ['Invoices'],
          summary: 'Void an open invoice',
          description:
            'The number stays on the record — an auditor seeing 0041 then 0043 needs to find 0042 voided, not missing. A paid invoice needs a credit note instead.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: { 'application/json': { schema: z.object({ reason: z.string() }) } },
          },
          responses: {
            '200': {
              description: 'Voided.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('Only an open invoice can be voided.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/pdf': {
        get: {
          tags: ['Invoices'],
          summary: 'Download the invoice PDF',
          requestParams: {
            path: z.object({ id: z.string() }),
            query: z.object({
              download: z.string().optional().meta({ description: '1 for Content-Disposition: attachment.' }),
            }),
          },
          responses: {
            '200': { description: 'The PDF.', content: { 'application/pdf': {} } },
            ...commonErrors,
          },
        },
      },

      '/invoice-items': {
        get: {
          tags: ['InvoiceItems'],
          summary: 'List lines of one invoice',
          requestParams: {
            query: z.object({
              invoice: z.string().meta({ description: '`in_…` or UUID.' }),
            }),
          },
          responses: {
            '200': {
              description: 'The invoice lines.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(lineItemOut) }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['InvoiceItems'],
          summary: 'Append a line to a draft',
          description:
            'Either `price` or (`description` + `unit_amount`). Totals recompute, so the response is the whole invoice.',
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  invoice: z.string(),
                  price: z.string().optional(),
                  description: z.string().optional(),
                  quantity: z.number().optional(),
                  unit: z.string().optional(),
                  unit_amount: minor.optional(),
                  discount_percent: z.number().optional(),
                  tax_rate: z.number().optional(),
                }),
              },
            },
          },
          responses: {
            '201': {
              description: 'Line added.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('The invoice has been finalized and can no longer be edited.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoice-items/{id}': {
        get: {
          tags: ['InvoiceItems'],
          summary: 'Read one line',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The line.',
              content: { 'application/json': { schema: z.object({ data: lineItemOut }) } },
            },
            '404': problemResponse('No such line.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['InvoiceItems'],
          summary: 'Remove a line from a draft',
          description: 'Pass `?invoice=` to scope the search. A draft always keeps at least one line.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Removed. The updated invoice.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '404': problemResponse('No such line.'),
            '409': problemResponse('The invoice has been finalized.'),
            ...commonErrors,
          },
        },
      },

      '/webhook-endpoints': {
        get: {
          tags: ['Webhooks'],
          summary: 'List webhook endpoints',
          description: 'Secrets are never returned here — only once, at creation.',
          responses: {
            '200': {
              description: 'Your endpoints.',
              content: { 'application/json': { schema: z.object({ data: z.array(webhookEndpointOut) }) } },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Webhooks'],
          summary: 'Register a webhook endpoint',
          description:
            'The response carries the signing secret, once. The URL must be https and must not resolve to a private or link-local address.',
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  url: z.string(),
                  events: z
                    .array(z.string())
                    .optional()
                    .meta({ description: 'Omit or leave empty to receive every event type.' }),
                }),
              },
            },
          },
          responses: {
            '201': {
              description: 'Registered. `secret` appears only in this response.',
              content: {
                'application/json': {
                  schema: z.object({ data: webhookEndpointOut.extend({ secret: z.string() }) }),
                },
              },
            },
            '422': problemResponse('Invalid URL, or an unknown event type.'),
            ...commonErrors,
          },
        },
      },

      '/webhook-endpoints/{id}': {
        delete: {
          tags: ['Webhooks'],
          summary: 'Delete a webhook endpoint',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '204': { description: 'Deleted.' },
            '404': problemResponse('No such endpoint.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/events': {
        get: {
          tags: ['Invoices'],
          summary: 'Invoice history',
          description:
            '`viewed` and `downloaded` come from the public share link and are written by the database, so they appear here without passing through the API.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Events, newest first.',
              content: { 'application/json': { schema: z.object({ data: z.array(eventOut) }) } },
            },
            ...commonErrors,
          },
        },
      },
    },
  })
}

/** Exposed for the docs page and the Postman generator. */
export const SCOPE_LIST = SCOPES.map((scope) => ({
  scope,
  description: SCOPE_DESCRIPTIONS[scope],
}))
