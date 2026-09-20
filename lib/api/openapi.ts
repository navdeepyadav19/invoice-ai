import * as z from 'zod'
import { createDocument } from 'zod-openapi'

import { SCOPES, SCOPE_DESCRIPTIONS } from '@/lib/auth/scopes'
import { clientSchema, invoiceSchema, lineItemSchema } from '@/lib/validators'

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
 * Note the money fields below are `*_paise` integers. The database stores
 * rupees as numeric(14,2), and lib/money-api.ts converts at the edge — see the
 * comment there for why the wire contract must not carry decimals.
 */

const paise = z
  .number()
  .int()
  .meta({ description: 'Amount in paise. 2500000 is ₹25,000.', examples: [2500000] })

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
  state_code: z.string().nullable(),
  pincode: z.string().nullable(),
  country: z.string().nullable(),
})

const clientOut = z
  .object({
    id: z.string(),
    name: z.string(),
    gstin: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: addressSchema,
    archived: z.boolean(),
    archived_at: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .meta({ id: 'Client' })

const lineItemOut = z
  .object({
    id: z.string(),
    position: z.number().int(),
    description: z.string(),
    hsn_sac: z.string().nullable(),
    quantity: z.number(),
    unit: z.string(),
    rate_paise: paise,
    discount_percent: z.number(),
    gst_rate: z.number().meta({ description: 'GST slab as a percentage: 0, 5, 12, 18, 28.' }),
    cess_rate: z.number(),
    taxable_value_paise: paise,
    cgst_amount_paise: paise,
    sgst_amount_paise: paise,
    igst_amount_paise: paise,
    cess_amount_paise: paise,
    line_total_paise: paise,
  })
  .meta({ id: 'LineItem' })

const invoiceOut = z
  .object({
    id: z.string(),
    invoice_number: z
      .string()
      .nullable()
      .meta({ description: 'Null until issued. A draft has no number because none was spent on it.' }),
    status: z
      .enum(['draft', 'sent', 'paid', 'overdue', 'cancelled'])
      .meta({ description: '`overdue` is derived from due_date at read time and is never stored.' }),
    client_id: z.string().nullable(),
    issue_date: z.string(),
    due_date: z.string().nullable(),
    currency: z.string(),
    place_of_supply_state_code: z.string(),
    is_export: z.boolean(),
    reverse_charge: z.boolean(),
    notes: z.string().nullable(),
    terms: z.string().nullable(),
    subtotal_paise: paise,
    discount_total_paise: paise,
    taxable_total_paise: paise,
    cgst_total_paise: paise,
    sgst_total_paise: paise,
    igst_total_paise: paise,
    cess_total_paise: paise,
    round_off_paise: paise,
    total_paise: paise,
    amount_in_words: z.string().nullable(),
    public_url_token: z.string(),
    issued_at: z.string().nullable(),
    paid_at: z.string().nullable(),
    cancelled_at: z.string().nullable(),
    cancel_reason: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
    items: z.array(lineItemOut).optional(),
  })
  .meta({ id: 'Invoice' })

const eventOut = z
  .object({
    id: z.string(),
    type: z.string().meta({
      description: 'invoice.created | invoice.issued | invoice.emailed | invoice.viewed | …',
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
      version: '1.0.0',
      description: [
        'GST-compliant invoicing over HTTP.',
        '',
        '## Authentication',
        'Send your API key as `Authorization: Bearer inv_live_…`. Keys are created in',
        'Settings → API keys and shown once. Key management is deliberately not available',
        'through this API, so a leaked key cannot mint more keys.',
        '',
        '## Money',
        'All amounts are integer **paise** (`2500000` is ₹25,000). JSON numbers are IEEE',
        'doubles, so a contract carrying rupees as decimals would eventually disagree with',
        'itself about a total.',
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
      { name: 'Clients' },
      { name: 'Invoices' },
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

      '/clients': {
        get: {
          tags: ['Clients'],
          summary: 'List clients',
          requestParams: {
            query: cursorParams.extend({
              query: z.string().optional().meta({ description: 'Case-insensitive name match.' }),
              include_archived: z.boolean().optional(),
            }),
          },
          responses: {
            '200': {
              description: 'A page of clients.',
              content: {
                'application/json': {
                  schema: z.object({ data: z.array(clientOut), next_cursor: z.string().nullable() }),
                },
              },
            },
            ...commonErrors,
          },
        },
        post: {
          tags: ['Clients'],
          summary: 'Create a client',
          requestBody: { content: { 'application/json': { schema: clientSchema } } },
          responses: {
            '201': {
              description: 'Created.',
              content: { 'application/json': { schema: z.object({ data: clientOut }) } },
            },
            '422': problemResponse('Validation failed. See `errors[]`.'),
            ...commonErrors,
          },
        },
      },

      '/clients/{id}': {
        get: {
          tags: ['Clients'],
          summary: 'Read a client',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'The client.',
              content: { 'application/json': { schema: z.object({ data: clientOut }) } },
            },
            '404': problemResponse('No such client, or it belongs to another owner.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Clients'],
          summary: 'Update a client',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: clientSchema.partial() } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: clientOut }) } },
            },
            '404': problemResponse('No such client.'),
            ...commonErrors,
          },
        },
      },

      '/clients/{id}/archive': {
        post: {
          tags: ['Clients'],
          summary: 'Archive a client',
          description:
            'Archive rather than delete: issued invoices reference clients and must keep naming who they were billed to. Archiving twice succeeds.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Archived.',
              content: { 'application/json': { schema: z.object({ data: clientOut }) } },
            },
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Clients'],
          summary: 'Un-archive a client',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Restored.',
              content: { 'application/json': { schema: z.object({ data: clientOut }) } },
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
              status: z.enum(['draft', 'sent', 'paid', 'overdue', 'cancelled']).optional(),
              client_id: z.string().optional(),
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
            'Requires an `Idempotency-Key`. A retried create would otherwise make a second identical draft with no way to tell which one to issue.',
          requestBody: { content: { 'application/json': { schema: invoiceSchema } } },
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
              description: 'The invoice, with line items.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '404': problemResponse('No such invoice, or it belongs to another owner.'),
            ...commonErrors,
          },
        },
        patch: {
          tags: ['Invoices'],
          summary: 'Update a draft',
          description: 'Drafts only. An issued invoice is frozen — the client already has the PDF.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: { content: { 'application/json': { schema: invoiceSchema } } },
          responses: {
            '200': {
              description: 'Updated.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('The invoice has been issued and can no longer be edited.'),
            ...commonErrors,
          },
        },
        delete: {
          tags: ['Invoices'],
          summary: 'Delete a draft',
          description:
            'Drafts only. An issued invoice holds a number in a series GST requires to be consecutive — cancel it instead.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '204': { description: 'Deleted.' },
            '409': problemResponse('The invoice has been issued. Cancel it instead.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/issue': {
        post: {
          tags: ['Invoices'],
          summary: 'Assign a GST invoice number',
          description:
            'Permanent and one-way. Requires an `Idempotency-Key`; a retry replays the first response. Even without one, issuing twice returns the same number.',
          requestParams: { path: z.object({ id: z.string() }) },
          responses: {
            '200': {
              description: 'Issued.',
              content: {
                'application/json': {
                  schema: z.object({
                    data: z.object({
                      id: z.string(),
                      invoice_number: z.string(),
                      status: z.string(),
                    }),
                  }),
                },
              },
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
          summary: 'Email the invoice to the client',
          description:
            'Issues it first if it has no number. Rate-limited to 10/hour — each call costs money and lands in a third party’s inbox.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  to: z.string().optional().meta({ description: 'Overrides the client’s stored email.' }),
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
            '502': problemResponse('The invoice was issued but the email failed. The number is spent.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/mark-paid': {
        post: {
          tags: ['Invoices'],
          summary: 'Mark an invoice paid',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: {
              'application/json': {
                schema: z.object({
                  paid_on: z.string().optional(),
                  reference: z.string().optional().meta({ description: 'UTR, cheque number, etc.' }),
                }),
              },
            },
          },
          responses: {
            '200': {
              description: 'Marked paid.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('Only an issued invoice can be marked paid.'),
            '428': problemResponse('Idempotency-Key header is required.'),
            ...commonErrors,
          },
        },
      },

      '/invoices/{id}/cancel': {
        post: {
          tags: ['Invoices'],
          summary: 'Cancel an issued invoice',
          description:
            'The number stays on the record — an auditor seeing 0041 then 0043 needs to find 0042 cancelled, not missing. A paid invoice needs a credit note instead.',
          requestParams: { path: z.object({ id: z.string() }) },
          requestBody: {
            content: { 'application/json': { schema: z.object({ reason: z.string() }) } },
          },
          responses: {
            '200': {
              description: 'Cancelled.',
              content: { 'application/json': { schema: z.object({ data: invoiceOut }) } },
            },
            '409': problemResponse('Only an issued invoice can be cancelled.'),
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

export { lineItemSchema }
