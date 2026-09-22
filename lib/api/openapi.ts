import * as z from 'zod'
import { createDocument, type ZodOpenApiOperationObject } from 'zod-openapi'

import { SCOPES, SCOPE_DESCRIPTIONS, type Scope } from '@/lib/auth/scopes'
import { UNITS } from '@/lib/units'
import {
  customerWireSchema,
  invoiceWireSchema,
  priceWireSchema,
  priceWireUpdateSchema,
  productSchema,
  productUpdateSchema,
  RECURRING_INTERVALS,
} from '@/lib/validators'
import { WEBHOOK_EVENTS } from '@/lib/webhooks/events'

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
 *                                          ├►  api-docs/openapi.json (Mintlify)
 *                                          └►  the Postman collection
 *
 * Request bodies are the runtime validators with a `description` layered onto
 * each field via `documented()` — the constraints (min, max, enums, required)
 * still come from lib/validators.ts, only the prose is added here.
 *
 * Resource and field names follow Stripe (`customer`, `unit_amount`,
 * `recurring.interval`, `cus_…` / `prod_…` / `price_…` / `in_…` / `ii_…` ids).
 * Money is integer minor units throughout — see lib/money-api.ts for why the
 * wire contract must not carry decimals.
 *
 * Every operation declares the scope its route passes to `withApi({ scope })`
 * as `x-required-scope`, and lib/api/openapi.test.ts checks that every route
 * file under app/api/v1 is documented here (and nothing else is).
 */

export const PRODUCTION_SERVER_URL = 'https://invoice.horizonpay.co/api/v1'

const PROBLEM_BASE = 'https://invoice.horizonpay.co/problems'

// ---------------------------------------------------------------------------
// Example values — kept consistent with EXAMPLE_BODIES in
// scripts/generate-postman.ts so the reference and the collection tell the
// same story (Acme Industries, a $25,000/month consulting retainer).
// ---------------------------------------------------------------------------

const EX = {
  customer: 'cus_Nf3kQ8pR2mX7vB1cT9wL4sZ6',
  product: 'prod_Hy7Rq2Lm9Xc4Vb8Nt3Kd6Pw1',
  price: 'price_Jc5Tn8Wq1Ze6Ra3Ym9Ub2Gs7',
  invoice: 'in_Pb2Xk7Mv4Qs9Lr1Wd6Tn3Fh8',
  line1: 'ii_Da4Vq9Ns2Kx7Bm3Yt8Rc1Lp6',
  line2: 'ii_Ew8Hz3Jc6Tq1Ms5Nv9Kb2Xr4',
  line3: 'ii_Gk2Rw7Lq4Zt9Xn1Vb6Mc3Hs8',
  business: '0c6f2d8e-3a41-4b9e-8f17-5d2a9c4e1b73',
  webhook: '4f9c2a1e-7b3d-4e8a-9c6f-2d1b0a3e5f71',
  event: '9b1e5c7a-2d4f-4a86-b3e0-7c5d1f9a2e64',
  apiKey: '6d3a9f1c-8e2b-4c75-a0d4-1f7e3b9c5a28',
  publicToken: '2b7e4c1a-9f3d-4e68-8a5b-0d1c7f3e9a46',
  requestId: 'req_7f3c9a1e2b4d4e8a9c6f2d1b0a3e5f71',
  created: '2026-09-22T09:30:00.000Z',
  updated: '2026-09-22T09:45:00.000Z',
  finalized: '2026-09-22T10:00:00.000Z',
  paid: '2026-09-29T14:20:00.000Z',
  issueDate: '2026-09-22',
  dueDate: '2026-10-22',
  number: 'INV-0042',
} as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type FieldMeta = {
  description: string
  examples?: unknown[]
}

/**
 * Add a description (and examples) to each field of a runtime validator
 * without re-declaring its constraints. `.meta()` returns a copy, so the
 * validators used at runtime are untouched.
 */
function documented<S extends z.ZodObject>(
  schema: S,
  docs: { [K in keyof S['shape']]: FieldMeta },
  objectMeta?: { id?: string; description?: string },
): S {
  const shape = schema.shape as Record<string, z.ZodType>
  const overrides = Object.fromEntries(
    Object.entries(docs as Record<string, FieldMeta>).map(([key, meta]) => [key, shape[key].meta(meta)]),
  )
  const extended = schema.extend(overrides) as unknown as S
  return (objectMeta ? extended.meta(objectMeta) : extended) as S
}

const dateTime = (description: string) => z.string().meta({ description, format: 'date-time' })

/** A nullable timestamp, with the description on the property rather than inside `anyOf`. */
const nullableDateTime = (description: string) =>
  z.string().meta({ format: 'date-time' }).nullable().meta({ description })

const minor = (description: string, example = 250000) =>
  z.number().int().meta({
    description: `${description} Integer minor units of the currency (\`250000\` is $2,500.00; ¥5,000 is \`5000\`).`,
    examples: [example],
  })

const idParam = (description: string, example: string) =>
  z.object({ id: z.string().meta({ description, examples: [example] }) })

// ---------------------------------------------------------------------------
// Problem details (RFC 9457)
// ---------------------------------------------------------------------------

const PROBLEM_CODES = {
  validation: 'The body or a query parameter (including `cursor`) failed validation. See `errors[]`.',
  idempotency_mismatch: 'The `Idempotency-Key` was already used with a different request body. Use a new key per distinct request.',
  unauthorized: 'Missing, malformed, unknown, revoked or expired API key.',
  forbidden: 'The key is valid but lacks the scope this operation requires.',
  not_found: 'No such resource — or it belongs to another account.',
  invalid_state: 'The resource exists but is in the wrong state for this operation.',
  conflict: 'A request with the same Idempotency-Key is still in flight, or a uniqueness clash.',
  idempotency_key_required: 'This operation requires an `Idempotency-Key` header.',
  rate_limited: 'Too many requests for this key. Wait `Retry-After` seconds.',
  upstream_failed: 'A dependency (email provider, database) failed. Usually safe to retry.',
  internal_error: 'An unexpected error on our side. Quote `instance` to support.',
} as const

type ProblemCode = keyof typeof PROBLEM_CODES

const problemSchema = z
  .object({
    type: z.string().meta({
      description: `A URI identifying the problem type: \`${PROBLEM_BASE}/<code>\` with underscores as hyphens.`,
      examples: [`${PROBLEM_BASE}/invalid-state`],
    }),
    title: z.string().meta({ description: 'Short, human-readable summary of the problem type.', examples: ['Invalid state for this operation'] }),
    status: z.number().int().meta({ description: 'The HTTP status code, repeated for convenience.', examples: [409] }),
    detail: z.string().meta({
      description: 'Human-readable explanation of this occurrence. Wording may change — do not parse it.',
      examples: ['This invoice has been finalized and can no longer be edited.'],
    }),
    instance: z.string().meta({
      description: 'The request id (also sent as `X-Request-Id`), for correlating with our logs.',
      examples: [EX.requestId],
    }),
    code: z.string().meta({
      description: `Stable machine-readable code. Branch on this, never on \`detail\`. One of: ${Object.keys(PROBLEM_CODES)
        .map((code) => `\`${code}\``)
        .join(', ')}.`,
      examples: ['invalid_state'],
    }),
    errors: z
      .array(
        z.object({
          path: z.string().meta({ description: 'Dot-path of the offending field, e.g. `items.0.unit_amount`.', examples: ['email'] }),
          message: z.string().meta({ description: 'What is wrong with it.', examples: ['Enter a valid email'] }),
        }),
      )
      .optional()
      .meta({ description: 'Field-level problems. Present on `validation` errors only.' }),
  })
  .meta({
    id: 'Problem',
    description:
      'An RFC 9457 problem details object, served as `application/problem+json`. Every non-2xx response uses this shape.',
  })

const TITLES: Record<ProblemCode, string> = {
  validation: 'Validation failed',
  idempotency_mismatch: 'Idempotency-Key reused',
  unauthorized: 'Unauthorized',
  forbidden: 'Insufficient scope',
  not_found: 'Not found',
  invalid_state: 'Invalid state for this operation',
  conflict: 'Conflict',
  idempotency_key_required: 'Idempotency-Key required',
  rate_limited: 'Too many requests',
  upstream_failed: 'Upstream service failed',
  internal_error: 'Internal server error',
}

const STATUS: Record<ProblemCode, number> = {
  validation: 422,
  idempotency_mismatch: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid_state: 409,
  conflict: 409,
  idempotency_key_required: 428,
  rate_limited: 429,
  upstream_failed: 502,
  internal_error: 500,
}

interface ProblemExample {
  code: ProblemCode
  detail: string
  errors?: { path: string; message: string }[]
}

function problemExample({ code, detail, errors }: ProblemExample) {
  return {
    type: `${PROBLEM_BASE}/${code.replace(/_/g, '-')}`,
    title: TITLES[code],
    status: STATUS[code],
    detail,
    instance: EX.requestId,
    code,
    ...(errors ? { errors } : {}),
  }
}

/** A problem+json response whose description lists the `code` values it can carry. */
function problem(description: string, examples: ProblemExample[], id?: string) {
  const codes = [...new Set(examples.map((e) => e.code))]
  return {
    ...(id ? { id } : {}),
    description: `${description} Codes: ${codes.map((c) => `\`${c}\``).join(', ')}.`,
    content: {
      'application/problem+json': {
        schema: problemSchema,
        examples: Object.fromEntries(
          examples.map((example, index) => [
            examples.length === 1 ? example.code : `${example.code}_${index + 1}`,
            { summary: example.detail, value: problemExample(example) },
          ]),
        ),
      },
    },
  }
}

const unauthorizedResponse = problem(
  'The API key is missing, malformed, unknown, revoked or expired. The response carries `WWW-Authenticate: Bearer`.',
  [{ code: 'unauthorized', detail: 'Send your API key as `Authorization: Bearer inv_live_…`.' }],
  'Unauthorized',
)

const forbiddenResponse = problem(
  'The key is valid but lacks a scope this operation needs (see `x-required-scope`).',
  [{ code: 'forbidden', detail: 'This credential is missing the invoices:write scope.' }],
  'Forbidden',
)

const rateLimitedResponse = {
  ...problem(
    'Rate limit exceeded for this API key. Wait the number of seconds in `Retry-After` before retrying.',
    [{ code: 'rate_limited', detail: 'Rate limit of 120 per 60s exceeded.' }],
    'RateLimited',
  ),
  headers: {
    'Retry-After': { $ref: '#/components/headers/RetryAfter' },
    'X-Request-Id': { $ref: '#/components/headers/RequestId' },
  },
}

/** Every authenticated endpoint can produce these, so they're declared once as components. */
const commonErrors = {
  '401': unauthorizedResponse,
  '403': forbiddenResponse,
  '429': rateLimitedResponse,
}

const notFound = (what: string, detail: string) =>
  problem(`${what} Another account's resource is also a \`404\`, so ids cannot be probed.`, [
    { code: 'not_found', detail },
  ])

/** A 422. Examples are `validation` unless they name another code (IDEMPOTENCY_MISMATCH). */
const validationFailed = (description: string, examples: Array<Omit<ProblemExample, 'code'> & { code?: ProblemCode }>) =>
  problem(
    description,
    examples.map((example) => ({ code: 'validation' as const, ...example })),
  )

const IDEMPOTENCY_MISMATCH: ProblemExample = {
  code: 'idempotency_mismatch',
  detail: 'This Idempotency-Key was already used with a different request body.',
  errors: [{ path: 'Idempotency-Key', message: 'Generate a new key per distinct request, not per retry loop.' }],
}

const INVALID_CURSOR: Omit<ProblemExample, 'code'> = {
  detail: 'The cursor is not valid.',
  errors: [{ path: 'cursor', message: 'Pass the `next_cursor` from the previous page, unchanged.' }],
}

/** Every paginated list rejects a cursor it did not issue, rather than serving page one again. */
const invalidCursor = validationFailed('`cursor` is not a `next_cursor` this API returned.', [INVALID_CURSOR])

const IN_FLIGHT: ProblemExample = {
  code: 'conflict',
  detail: 'A request with this Idempotency-Key is still in flight. Retry in a moment.',
}

const idempotencyRequired = problem(
  'No `Idempotency-Key` header was sent. This operation refuses to run without one.',
  [
    {
      code: 'idempotency_key_required',
      detail:
        'This operation assigns or spends an invoice number. Send an Idempotency-Key header so a retry cannot do it twice.',
    },
  ],
  'IdempotencyKeyRequired',
)

// ---------------------------------------------------------------------------
// Headers
// ---------------------------------------------------------------------------

const componentHeaders = {
  RequestId: z.string().meta({
    description:
      'The request id: yours, if you sent `X-Request-Id` (up to 200 characters), otherwise one we generated. Quote it to support.',
    examples: [EX.requestId],
  }),
  RateLimitLimit: z.number().int().meta({
    description: 'Requests allowed in the current window for this key and bucket.',
    examples: [120],
  }),
  RateLimitRemaining: z.number().int().meta({ description: 'Requests left in the current window.', examples: [119] }),
  RateLimitReset: z.number().int().meta({ description: 'Unix time (seconds) at which the window resets.', examples: [1789371294] }),
  RetryAfter: z.number().int().meta({ description: 'Seconds to wait before retrying.', examples: [42] }),
  IdempotentReplayed: z.enum(['true']).optional().meta({
    description:
      'Present and `true` when this response is a replay of the first response stored under the same `Idempotency-Key` — the operation did not run again.',
  }),
}

const successHeaders = {
  'X-Request-Id': { $ref: '#/components/headers/RequestId' },
  'RateLimit-Limit': { $ref: '#/components/headers/RateLimitLimit' },
  'RateLimit-Remaining': { $ref: '#/components/headers/RateLimitRemaining' },
  'RateLimit-Reset': { $ref: '#/components/headers/RateLimitReset' },
}

type Idempotency = 'required' | 'optional'

function ok(
  description: string,
  schema: z.ZodType,
  example: unknown,
  idempotency?: Idempotency,
) {
  return {
    description,
    headers: idempotency
      ? { ...successHeaders, 'Idempotent-Replayed': { $ref: '#/components/headers/IdempotentReplayed' } }
      : successHeaders,
    content: { 'application/json': { schema, example } },
  }
}

function noContentResponse(description: string) {
  return { description, headers: successHeaders }
}

// ---------------------------------------------------------------------------
// Resource schemas (responses)
// ---------------------------------------------------------------------------

const customerOut = z
  .object({
    id: z.string().meta({ description: 'Unique identifier, `cus_…`.', examples: [EX.customer] }),
    object: z.literal('customer').meta({ description: 'Always `customer`.' }),
    name: z.string().meta({ description: 'Full name or legal business name.', examples: ['Acme Industries'] }),
    email: z.string().nullable().meta({ description: 'Billing email, copied onto invoices for this customer — where `POST /invoices/{id}/send` delivers by default.', examples: ['ap@acme.example'] }),
    phone: z.string().nullable().meta({ description: 'Phone number, free text.', examples: ['+1 512 555 0100'] }),
    tax_id: z.string().nullable().meta({
      description: 'Tax registration number (VAT, EIN, GSTIN, ABN…), free text. Printed on invoices.',
      examples: ['US-EIN 12-3456789'],
    }),
    address: z
      .object({
        line1: z.string().nullable().meta({ description: 'Street address.', examples: ['4th Floor, Market Tower'] }),
        line2: z.string().nullable().meta({ description: 'Apartment, suite, unit.' }),
        city: z.string().nullable().meta({ description: 'City or locality.', examples: ['Austin'] }),
        state: z.string().nullable().meta({ description: 'State, province or region.', examples: ['TX'] }),
        postal_code: z.string().nullable().meta({ description: 'ZIP or postal code.', examples: ['73301'] }),
        country: z.string().nullable().meta({ description: 'ISO 3166-1 alpha-2 country code.', examples: ['US'] }),
      })
      .meta({ description: 'Billing address. Every field may be null.' }),
    deleted: z.boolean().meta({
      description: 'True once archived with `DELETE /customers/{id}`. Archived customers stay readable.',
    }),
    created: dateTime('When the customer was created (ISO 8601).'),
  })
  .meta({ id: 'Customer', description: 'Someone you bill. Customers are archived, never hard-deleted.' })

const productOut = z
  .object({
    id: z.string().meta({ description: 'Unique identifier, `prod_…`.', examples: [EX.product] }),
    object: z.literal('product').meta({ description: 'Always `product`.' }),
    name: z.string().meta({ description: 'Shown as the line description when a price of this product is billed.', examples: ['Consulting retainer'] }),
    description: z.string().nullable().meta({ description: 'Longer description for your own reference.', examples: ['Monthly advisory block.'] }),
    images: z.array(z.string()).meta({ description: 'Up to 8 image URLs.', examples: [[]] }),
    active: z.boolean().meta({ description: '`false` once archived. Archived products keep their prices and history.' }),
    created: dateTime('When the product was created (ISO 8601).'),
    updated: dateTime('When the product was last changed (ISO 8601).'),
  })
  .meta({ id: 'Product', description: 'Something you sell. Money lives on its prices, not on the product.' })

const priceOut = z
  .object({
    id: z.string().meta({ description: 'Unique identifier, `price_…`.', examples: [EX.price] }),
    object: z.literal('price').meta({ description: 'Always `price`.' }),
    product: z.string().nullable().meta({ description: 'The parent product, `prod_…`. Cannot change after creation.', examples: [EX.product] }),
    nickname: z.string().nullable().meta({ description: 'Internal label, e.g. "Monthly".', examples: ['Monthly'] }),
    unit_amount: minor('Price per unit.', 2500000),
    currency: z.string().meta({ description: 'ISO 4217 currency code, uppercase.', examples: ['USD'] }),
    billing_scheme: z.literal('per_unit').meta({ description: 'Always `per_unit`.' }),
    type: z.enum(['one_time', 'recurring']).meta({ description: '`recurring` prices carry `recurring`; nothing auto-bills them yet.' }),
    recurring: z
      .object({
        interval: z.string().nullable().meta({ description: '`day`, `week`, `month` or `year`.', examples: ['month'] }),
        interval_count: z.number().int().meta({ description: 'Number of intervals between bills (1–52).', examples: [1] }),
      })
      .nullable()
      .meta({ description: 'Billing cadence. `null` on one-time prices.' }),
    tax_rate: z.number().meta({ description: 'Default tax percentage (0–100) for lines billed from this price.', examples: [0] }),
    active: z.boolean().meta({ description: '`false` once archived. Archived prices cannot be chosen for new lines in the app.' }),
    created: dateTime('When the price was created (ISO 8601).'),
  })
  .meta({ id: 'Price', description: 'One way to charge for a product: an amount in a currency, one-time or recurring.' })

const lineItemOut = z
  .object({
    id: z.string().meta({ description: 'Unique identifier, `ii_…`. Lines get new ids whenever the draft is re-saved.', examples: [EX.line1] }),
    object: z.literal('invoiceitem').meta({ description: 'Always `invoiceitem`.' }),
    price: z.string().nullable().meta({ description: 'The `price_…` this line was billed from, or `null` for an ad-hoc line.', examples: [EX.price] }),
    product: z.string().nullable().meta({ description: "The price's product, `prod_…`, or `null`.", examples: [EX.product] }),
    description: z.string().meta({ description: 'What is being billed. Defaults to the product name on priced lines.', examples: ['Consulting retainer'] }),
    quantity: z.number().meta({ description: 'Quantity, greater than zero. May be fractional.', examples: [1] }),
    unit: z.string().meta({ description: `Unit of measure: ${UNITS.map((u) => `\`${u}\``).join(', ')}.`, examples: ['NOS'] }),
    unit_amount: minor('Price per unit.', 2500000),
    amount: minor('Line total after discount, including tax.', 2500000),
    discount_percent: z.number().meta({ description: 'Discount percentage (0–100) applied before tax.', examples: [0] }),
    tax_rate: z.number().meta({ description: 'Tax percentage (0–100), exclusive — added on top of the discounted amount.', examples: [0] }),
    tax_amount: minor('Tax on this line.', 0),
  })
  .meta({ id: 'InvoiceItem', description: 'One line of an invoice. Totals are always recomputed server-side from the lines.' })

const invoiceOut = z
  .object({
    id: z.string().meta({ description: 'Unique identifier, `in_…`.', examples: [EX.invoice] }),
    object: z.literal('invoice').meta({ description: 'Always `invoice`.' }),
    number: z.string().nullable().meta({
      description:
        'The invoice number, e.g. `INV-0042` (your prefix + a zero-padded counter). `null` until finalized — a draft has no number because none was spent on it.',
      examples: [EX.number],
    }),
    status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).meta({
      description:
        '`draft` → `open` (finalize) → `paid` (pay) or `void`. `overdue` is an open invoice past `due_date`; it is derived at read time and never stored.',
      examples: ['open'],
    }),
    customer: z.string().nullable().meta({ description: 'The billed customer, `cus_…`.', examples: [EX.customer] }),
    currency: z.string().meta({ description: 'ISO 4217 currency code. Defaults to your business currency.', examples: ['USD'] }),
    collection_method: z.enum(['charge_automatically', 'send_invoice']).meta({
      description: 'How you intend to collect. Informational today; defaults to `send_invoice`.',
    }),
    issue_date: z.string().meta({ description: 'Issue date (ISO 8601 date). Set to the creation date.', format: 'date', examples: [EX.issueDate] }),
    due_date: z.string().nullable().meta({ description: 'Due date (ISO 8601 date), or `null`.', format: 'date', examples: [EX.dueDate] }),
    description: z.string().nullable().meta({ description: 'Notes printed on the invoice.', examples: ['Consulting retainer.'] }),
    footer: z.string().nullable().meta({ description: 'Terms printed at the foot of the invoice.', examples: ['Thank you for your business.'] }),
    subtotal: minor('Sum of quantity × unit_amount over all lines, before discount and tax.', 2550000),
    discount: minor('Total discount across lines.', 0),
    taxable: minor('`subtotal` − `discount`.', 2550000),
    tax: minor('Total tax across lines.', 0),
    total: minor('`taxable` + `tax`.', 2550000),
    amount_due: minor('What is still owed: `total` while `open` or `overdue`, otherwise 0.', 2550000),
    amount_in_words: z.string().nullable().meta({
      description: 'The total spelled out, as printed on the PDF.',
      examples: ['Twenty Five Thousand Five Hundred USD Only'],
    }),
    public_url_token: z.string().meta({
      description: 'Token of the public share link (`/i/{token}`). Anyone with it can view the invoice.',
      examples: [EX.publicToken],
    }),
    finalized_at: nullableDateTime('When the invoice was finalized, or `null`.'),
    paid_at: nullableDateTime('When the invoice was marked paid, or `null`.'),
    voided_at: nullableDateTime('When the invoice was voided, or `null`.'),
    void_reason: z.string().nullable().meta({ description: 'The reason given to `POST /invoices/{id}/void`.' }),
    created: dateTime('When the invoice was created (ISO 8601).'),
    updated: dateTime('When the invoice was last changed (ISO 8601).'),
    lines: z
      .object({ data: z.array(lineItemOut).meta({ description: 'The lines, in order.' }) })
      .optional()
      .meta({
        description:
          'The invoice lines. Included when reading or writing a single invoice; omitted from list results and from the pay and void responses.',
      }),
  })
  .meta({ id: 'Invoice', description: 'An invoice: a draft, or a numbered document once finalized.' })

const eventOut = z
  .object({
    id: z.string().meta({ description: 'Event id (UUID).', examples: [EX.event] }),
    type: z.enum(WEBHOOK_EVENTS).meta({
      description:
        'What happened. `invoice.viewed` and `invoice.downloaded` are recorded when the customer opens the public share link.',
      examples: ['invoice.finalized'],
    }),
    meta: z.record(z.string(), z.unknown()).nullable().meta({
      description: 'Context: `actor`, `request_id`, `api_key_id`, and event-specific fields such as `to`, `reason` or `reference`.',
      examples: [{ actor: 'api_key', request_id: EX.requestId, api_key_id: EX.apiKey }],
    }),
    created_at: dateTime('When it happened (ISO 8601).'),
  })
  .meta({ id: 'InvoiceEvent', description: 'One entry in an invoice’s history. The same names are used for webhook events.' })

const webhookEndpointOut = z
  .object({
    id: z.string().meta({ description: 'Endpoint id (UUID).', examples: [EX.webhook] }),
    url: z.string().meta({ description: 'The https URL deliveries are POSTed to.', examples: ['https://example.com/webhooks/invoice-ai'] }),
    events: z.array(z.enum(WEBHOOK_EVENTS)).meta({
      description: 'Subscribed event types. An endpoint registered with no events receives every type, and lists them all here.',
    }),
    active: z.boolean().meta({ description: '`false` once deliveries are disabled, which happens after 20 consecutive failures.' }),
    disabled_at: nullableDateTime('When deliveries were disabled, or `null`.'),
    failure_count: z.number().int().meta({ description: 'Consecutive failed deliveries.', examples: [0] }),
    created_at: dateTime('When the endpoint was registered (ISO 8601).'),
  })
  .meta({ id: 'WebhookEndpoint', description: 'A URL that receives signed invoice events (Standard Webhooks format).' })

const businessOut = z
  .object({
    id: z.string().meta({ description: 'Business id (UUID).', examples: [EX.business] }),
    legal_name: z.string().meta({ description: 'Registered legal name, printed as the invoice issuer.', examples: ['Horizon Consulting LLC'] }),
    trade_name: z.string().nullable().meta({ description: 'Trading name, if different.', examples: ['Horizon'] }),
    country_code: z.string().meta({ description: 'ISO 3166-1 alpha-2 country code.', examples: ['US'] }),
    currency: z.string().meta({ description: 'Default invoice currency (ISO 4217).', examples: ['USD'] }),
    tax_id: z.string().nullable().meta({ description: 'Your tax registration number, free text.', examples: ['US-EIN 98-7654321'] }),
    address: z
      .object({
        line1: z.string().nullable().meta({ description: 'Street address.', examples: ['500 Congress Ave'] }),
        line2: z.string().nullable().meta({ description: 'Suite, floor, unit.' }),
        city: z.string().nullable().meta({ description: 'City.', examples: ['Austin'] }),
        region: z.string().nullable().meta({ description: 'State, province or region.', examples: ['TX'] }),
        postal_code: z.string().nullable().meta({ description: 'ZIP or postal code.', examples: ['78701'] }),
        country_code: z.string().nullable().meta({ description: 'ISO 3166-1 alpha-2 country code.', examples: ['US'] }),
        country: z.string().nullable().meta({ description: 'Country name.', examples: ['United States'] }),
      })
      .meta({ description: 'Registered address.' }),
    email: z.string().nullable().meta({ description: 'Contact email printed on invoices.', examples: ['billing@horizon.example'] }),
    phone: z.string().nullable().meta({ description: 'Contact phone.', examples: ['+1 512 555 0199'] }),
    bank: z
      .object({
        bank_name: z.string().nullable().meta({ description: 'Bank name.', examples: ['First Austin Bank'] }),
        account_name: z.string().nullable().meta({ description: 'Account holder name.', examples: ['Horizon Consulting LLC'] }),
        account_number: z.string().nullable().meta({ description: 'Account number (or IBAN).', examples: ['000123456789'] }),
        routing_number: z.string().nullable().meta({ description: 'Routing number, sort code, IFSC or SWIFT.', examples: ['111000025'] }),
      })
      .meta({ description: 'Payment details printed on invoices.' }),
    invoice_prefix: z.string().meta({ description: 'Prefix of every invoice number, e.g. `INV` in `INV-0042`.', examples: ['INV'] }),
    created_at: dateTime('When the business profile was created (ISO 8601).'),
  })
  .meta({ id: 'Business', description: 'Your business profile — the "From" side of every invoice.' })

// ---------------------------------------------------------------------------
// Response examples
// ---------------------------------------------------------------------------

const customerExample = {
  id: EX.customer,
  object: 'customer',
  name: 'Acme Industries',
  email: 'ap@acme.example',
  phone: null,
  tax_id: 'US-EIN 12-3456789',
  address: { line1: '4th Floor, Market Tower', line2: null, city: 'Austin', state: 'TX', postal_code: '73301', country: 'US' },
  deleted: false,
  created: EX.created,
}

const productExample = {
  id: EX.product,
  object: 'product',
  name: 'Consulting retainer',
  description: 'Monthly advisory block.',
  images: [],
  active: true,
  created: EX.created,
  updated: EX.created,
}

const priceExample = {
  id: EX.price,
  object: 'price',
  product: EX.product,
  nickname: 'Monthly',
  unit_amount: 2500000,
  currency: 'USD',
  billing_scheme: 'per_unit',
  type: 'recurring',
  recurring: { interval: 'month', interval_count: 1 },
  tax_rate: 0,
  active: true,
  created: EX.created,
}

const pricedLine = {
  id: EX.line1,
  object: 'invoiceitem',
  price: EX.price,
  product: EX.product,
  description: 'Consulting retainer',
  quantity: 1,
  unit: 'NOS',
  unit_amount: 2500000,
  amount: 2500000,
  discount_percent: 0,
  tax_rate: 0,
  tax_amount: 0,
}

const adHocLine = {
  id: EX.line2,
  object: 'invoiceitem',
  price: null,
  product: null,
  description: 'Onboarding workshop',
  quantity: 1,
  unit: 'NOS',
  unit_amount: 50000,
  amount: 50000,
  discount_percent: 0,
  tax_rate: 0,
  tax_amount: 0,
}

const addedLine = { ...adHocLine, id: EX.line3, description: 'Extra review round', unit_amount: 10000, amount: 10000 }

const invoiceTotals = (total: number) => ({
  subtotal: total,
  discount: 0,
  taxable: total,
  tax: 0,
  total,
})

const draftInvoiceExample = {
  id: EX.invoice,
  object: 'invoice',
  number: null,
  status: 'draft',
  customer: EX.customer,
  currency: 'USD',
  collection_method: 'send_invoice',
  issue_date: EX.issueDate,
  due_date: EX.dueDate,
  description: 'Consulting retainer.',
  footer: null,
  ...invoiceTotals(2550000),
  amount_due: 0,
  amount_in_words: 'Twenty Five Thousand Five Hundred USD Only',
  public_url_token: EX.publicToken,
  finalized_at: null,
  paid_at: null,
  voided_at: null,
  void_reason: null,
  created: EX.created,
  updated: EX.created,
  lines: { data: [pricedLine, adHocLine] },
}

const updatedDraftExample = {
  ...draftInvoiceExample,
  description: 'Consulting retainer — net 30.',
  footer: 'Thank you for your business.',
  updated: EX.updated,
}

const draftWithAddedLine = {
  ...draftInvoiceExample,
  ...invoiceTotals(2560000),
  amount_in_words: 'Twenty Five Thousand Six Hundred USD Only',
  updated: EX.updated,
  lines: { data: [pricedLine, adHocLine, addedLine] },
}

const openInvoiceExample = {
  ...draftInvoiceExample,
  number: EX.number,
  status: 'open',
  amount_due: 2550000,
  finalized_at: EX.finalized,
  updated: EX.finalized,
}

const { lines: _lines, ...openWithoutLines } = openInvoiceExample
void _lines

const paidInvoiceExample = {
  ...openWithoutLines,
  status: 'paid',
  amount_due: 0,
  paid_at: EX.paid,
  updated: EX.paid,
}

const voidInvoiceExample = {
  ...openWithoutLines,
  status: 'void',
  amount_due: 0,
  voided_at: EX.paid,
  void_reason: 'Raised against the wrong customer.',
  updated: EX.paid,
}

const eventExamples = [
  { id: EX.event, type: 'invoice.paid', meta: { actor: 'api_key', request_id: EX.requestId, api_key_id: EX.apiKey, reference: 'chk_123456' }, created_at: EX.paid },
  { id: '3e8d1a6c-5f2b-4c90-a7e3-8b4d2f1c6a95', type: 'invoice.viewed', meta: null, created_at: '2026-09-23T08:12:00.000Z' },
  { id: '7a2c9e4f-1b6d-4f38-9e5a-2c8b6d4f1e07', type: 'invoice.emailed', meta: { to: 'ap@acme.example' }, created_at: '2026-09-22T10:00:05.000Z' },
  { id: '5c4f7b2e-9a1d-4e63-8f0b-6d3a2e9c7b18', type: 'invoice.finalized', meta: { actor: 'api_key', request_id: EX.requestId, api_key_id: EX.apiKey }, created_at: EX.finalized },
  { id: '1d9b6e3a-4c7f-4a25-b8e1-9f2c5a7d3b60', type: 'invoice.created', meta: { actor: 'api_key', request_id: EX.requestId, api_key_id: EX.apiKey }, created_at: EX.created },
]

const webhookExample = {
  id: EX.webhook,
  url: 'https://example.com/webhooks/invoice-ai',
  events: ['invoice.finalized', 'invoice.paid'],
  active: true,
  disabled_at: null,
  failure_count: 0,
  created_at: EX.created,
}

const businessExample = {
  id: EX.business,
  legal_name: 'Horizon Consulting LLC',
  trade_name: 'Horizon',
  country_code: 'US',
  currency: 'USD',
  tax_id: 'US-EIN 98-7654321',
  address: {
    line1: '500 Congress Ave',
    line2: 'Suite 1200',
    city: 'Austin',
    region: 'TX',
    postal_code: '78701',
    country_code: 'US',
    country: 'United States',
  },
  email: 'billing@horizon.example',
  phone: '+1 512 555 0199',
  bank: {
    bank_name: 'First Austin Bank',
    account_name: 'Horizon Consulting LLC',
    account_number: '000123456789',
    routing_number: '111000025',
  },
  invoice_prefix: 'INV',
  created_at: '2026-01-05T12:00:00.000Z',
}

const page = <T extends z.ZodType>(item: T, what: string) =>
  z.object({
    data: z.array(item).meta({ description: `${what}, newest first.` }),
    next_cursor: z.string().nullable().meta({
      description: 'Pass as `cursor` to fetch the next page. `null` on the last page.',
      examples: ['MjAyNi0wOS0yMlQwOTozMDowMC4wMDBafDdmM2M'],
    }),
  })

const single = <T extends z.ZodType>(item: T, description: string) =>
  z.object({ data: item.meta({ description }) })

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

const addressWire = customerWireSchema.shape.address.unwrap()

const customerCreateBody = documented(
  customerWireSchema.extend({
    address: documented(addressWire, {
      line1: { description: 'Street address.', examples: ['4th Floor, Market Tower'] },
      line2: { description: 'Apartment, suite, unit.' },
      city: { description: 'City or locality.', examples: ['Austin'] },
      state: { description: 'State, province or region.', examples: ['TX'] },
      postal_code: { description: 'ZIP or postal code.', examples: ['73301'] },
      country: { description: 'ISO 3166-1 alpha-2 country code (uppercased for you).', examples: ['US'] },
    }).optional(),
  }),
  {
    name: { description: 'Full name or legal business name.', examples: ['Acme Industries'] },
    email: { description: 'Billing email. `POST /invoices/{id}/send` delivers here unless you pass `to`. `""` clears it.', examples: ['ap@acme.example'] },
    phone: { description: 'Phone number, free text.', examples: ['+1 512 555 0100'] },
    tax_id: { description: 'Tax registration number (VAT, EIN, GSTIN…), free text — no format check.', examples: ['US-EIN 12-3456789'] },
    address: { description: 'Billing address. Every field is optional.' },
  },
  { id: 'CustomerCreate' },
)

const customerUpdateBody = customerCreateBody.partial().meta({
  id: 'CustomerUpdate',
  description: 'Any subset of the create fields. Omitted fields are left unchanged.',
})

const productFieldDocs = {
  name: { description: 'Product name, 1–200 characters. Becomes the default line description.', examples: ['Consulting retainer'] },
  description: { description: 'Longer description.', examples: ['Monthly advisory block.'] },
  images: { description: 'Up to 8 image URLs.', examples: [[]] },
  active: { description: 'Whether the product is available. Defaults to `true` on create.', examples: [true] },
}

const productCreateBody = documented(productSchema, productFieldDocs, { id: 'ProductCreate' })

const productUpdateBody = documented(
  productUpdateSchema,
  {
    ...productFieldDocs,
    description: { description: 'Longer description. `null` or `""` clears it.', examples: ['Monthly advisory block, up to 10 hours.'] },
    active: { description: '`false` archives, `true` restores.', examples: [true] },
  },
  { id: 'ProductUpdate', description: 'Any subset of fields. Omitted fields are left unchanged.' },
)

const recurringWire = priceWireSchema.shape.recurring.unwrap()

const recurringBody = documented(recurringWire, {
  interval: { description: `Billing interval: ${RECURRING_INTERVALS.map((i) => `\`${i}\``).join(', ')}.`, examples: ['month'] },
  interval_count: { description: 'Intervals between bills, 1–52. Defaults to 1.', examples: [1] },
})

const priceFieldDocs = {
  product: { description: 'The parent product, `prod_…` or UUID.', examples: [EX.product] },
  nickname: { description: 'Internal label, e.g. "Monthly".', examples: ['Monthly'] },
  unit_amount: { description: 'Price per unit in integer minor units (`2500000` is $25,000.00).', examples: [2500000] },
  currency: { description: 'ISO 4217 code, three letters (uppercased for you). Must match the invoice currency when billed.', examples: ['USD'] },
  type: { description: '`one_time` (default) or `recurring`. `recurring` requires `recurring.interval`.', examples: ['recurring'] },
  recurring: { description: 'Required when `type` is `recurring`; must be omitted for `one_time`.' },
  tax_rate: { description: 'Default tax percentage, 0–100, for lines billed from this price. Defaults to 0.', examples: [0] },
  active: { description: 'Whether the price is available. Defaults to `true`.', examples: [true] },
}

const priceCreateBody = documented(
  priceWireSchema.extend({ recurring: recurringBody.optional() }),
  priceFieldDocs,
  { id: 'PriceCreate' },
)

const priceUpdateBody = documented(
  priceWireUpdateSchema.extend({ recurring: recurringBody.optional() }),
  {
    ...priceFieldDocs,
    product: { description: 'Not updatable — sending it is a `422`. Create a new price on the other product instead.' },
    nickname: { description: 'Internal label. `null` or `""` clears it.', examples: ['Monthly (annual contract)'] },
    type: { description: 'Switching to `one_time` clears the interval; switching to `recurring` needs `recurring.interval` unless one is stored.', examples: ['recurring'] },
    active: { description: '`false` archives, `true` restores.', examples: [true] },
  },
  { id: 'PriceUpdate', description: 'Any subset of fields. Omitted fields are left unchanged.' },
)

const lineWire = invoiceWireSchema.shape.items.unwrap().element

const lineFieldDocs = {
  price: {
    description:
      'A catalog price, `price_…` or UUID. Its product name, unit amount and tax rate fill any of `description`, `unit_amount`, `tax_rate` you omit. Its currency must match the invoice.',
    examples: [EX.price],
  },
  description: { description: 'What you are billing for. Required unless `price` is given.', examples: ['Onboarding workshop'] },
  quantity: { description: 'Quantity, greater than zero. Defaults to 1.', examples: [1] },
  unit: { description: `Unit of measure. Defaults to \`NOS\` (numbers).`, examples: ['NOS'] },
  unit_amount: { description: 'Price per unit in integer minor units of the invoice currency. Required unless `price` is given.', examples: [50000] },
  discount_percent: { description: 'Discount percentage, 0–100, applied before tax. Defaults to 0.', examples: [0] },
  tax_rate: { description: 'Tax percentage, 0–100, added on top. Defaults to the price’s rate, or 0 on ad-hoc lines.', examples: [0] },
}

const lineBody = documented(lineWire, lineFieldDocs, { id: 'InvoiceLineInput', description: 'Either `price`, or `description` + `unit_amount`.' })

const invoiceFieldDocs = {
  customer: { description: 'The customer to bill, `cus_…` or UUID. Must already exist (`POST /customers`).', examples: [EX.customer] },
  currency: { description: 'ISO 4217 code. Defaults to your business currency.', examples: ['USD'] },
  collection_method: { description: 'Defaults to `send_invoice`. Informational today.', examples: ['send_invoice'] },
  due_date: { description: 'Due date, `YYYY-MM-DD`. `""` clears it.', examples: [EX.dueDate] },
  days_until_due: { description: 'Alternative to `due_date` on create only: issue date + N days (0–365). Ignored on update.', examples: [30] },
  description: { description: 'Notes printed on the invoice.', examples: ['Consulting retainer.'] },
  footer: { description: 'Terms printed at the foot of the invoice.', examples: ['Thank you for your business.'] },
  items: { description: 'The lines, at least one. On update, replaces every existing line; omit to keep them.' },
}

const invoiceCreateBody = documented(
  // `customer` is optional in the shared schema (PATCH is partial); create requires it.
  invoiceWireSchema.extend({ customer: z.string().trim().min(1), items: z.array(lineBody).min(1).optional() }),
  invoiceFieldDocs,
  { id: 'InvoiceCreate' },
)

const invoiceUpdateBody = documented(
  invoiceWireSchema.extend({ items: z.array(lineBody).min(1).optional() }),
  {
    ...invoiceFieldDocs,
    customer: {
      description: 'Bill a different customer, `cus_…` or UUID. Omit to keep the current one.',
      examples: [EX.customer],
    },
  },
  { id: 'InvoiceUpdate', description: 'Any subset of fields. Omitted fields keep their stored value; omit `items` to keep the lines.' },
)

/** Mirrors the route's schema: an invoice line plus the draft it goes on. */
const invoiceItemCreateBody = documented(
  lineBody.extend({ invoice: z.string().trim().min(1) }),
  {
    ...lineFieldDocs,
    invoice: { description: 'The draft to append to, `in_…` or UUID.', examples: [EX.invoice] },
  },
  { id: 'InvoiceItemCreate', description: 'Either `price`, or `description` + `unit_amount`.' },
)

const sendBody = z
  .object({
    to: z.string().optional().meta({
      description: 'Recipient email. Defaults to the customer email recorded on the invoice; one of the two is required.',
      examples: ['ap@acme.example'],
    }),
  })
  .meta({ id: 'InvoiceSend' })

const payBody = z
  .object({
    paid_on: z.string().optional().meta({
      description: 'When payment was received (ISO 8601 date or timestamp). Defaults to now.',
      examples: ['2026-09-29'],
    }),
    reference: z.string().optional().meta({
      description: 'Your payment reference (cheque number, bank transfer id). Recorded on the `invoice.paid` event.',
      examples: ['chk_123456'],
    }),
  })
  .meta({ id: 'InvoicePay' })

const voidBody = z
  .object({
    reason: z.string().min(1).meta({
      description: 'Why the invoice is void. Required and non-blank; stored as `void_reason`.',
      examples: ['Raised against the wrong customer.'],
    }),
  })
  .meta({ id: 'InvoiceVoid' })

const webhookCreateBody = z
  .object({
    url: z.string().meta({
      description: 'An `https://` URL that does not resolve to a private, loopback or link-local address.',
      examples: ['https://example.com/webhooks/invoice-ai'],
    }),
    events: z.array(z.enum(WEBHOOK_EVENTS)).optional().meta({
      description: 'Event types to receive. Omit or send `[]` to receive every type, including ones added later.',
      examples: [['invoice.finalized', 'invoice.paid']],
    }),
  })
  .meta({ id: 'WebhookEndpointCreate' })

const json = <T extends z.ZodType>(schema: T, example: unknown, description?: string) => ({
  required: true,
  ...(description ? { description } : {}),
  content: { 'application/json': { schema, example } },
})

// ---------------------------------------------------------------------------
// Query parameters
// ---------------------------------------------------------------------------

// Names and locations come from the object keys below — zod-openapi derives
// them from `requestParams`, and supplying them again in .meta({ param }) is a
// conflict it rejects at build time.
const cursorParams = z.object({
  cursor: z.string().optional().meta({ description: 'The `next_cursor` from the previous page. Opaque — do not build it yourself.' }),
  limit: z.number().int().min(1).max(100).default(25).meta({ description: 'Page size, 1–100. Defaults to 25.' }),
})

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

interface OperationSpec extends Omit<ZodOpenApiOperationObject, 'operationId' | 'tags' | 'summary' | 'description'> {
  operationId: string
  tag: Tag
  summary: string
  description: string
  /** The scope the route passes to withApi({ scope }). */
  scope: Scope
  /** Scopes the service layer also checks along the way. */
  alsoRequires?: { scope: Scope; when?: string }[]
  /** Mirrors withApi({ idempotent }). */
  idempotency?: Idempotency
}

type Tag = 'Business' | 'Customers' | 'Products' | 'Prices' | 'Invoices' | 'Invoice items' | 'Webhook endpoints'

const IDEMPOTENCY_TEXT: Record<Idempotency, string> = {
  required:
    '**Idempotency:** `Idempotency-Key` header **required** (`428` without it). A retry with the same key and body replays the first response with `Idempotent-Replayed: true`; the same key with a different body is a `422` `idempotency_mismatch`.',
  optional:
    '**Idempotency:** `Idempotency-Key` header optional. When sent, a retry with the same key and body replays the first response with `Idempotent-Replayed: true`; the same key with a different body is a `422` `idempotency_mismatch`.',
}

function operation(spec: OperationSpec): ZodOpenApiOperationObject {
  const { tag, scope, alsoRequires, idempotency, description, requestParams, ...rest } = spec

  const scopeLine = [
    `**Scope:** \`${scope}\``,
    ...(alsoRequires ?? []).map((extra) => `\`${extra.scope}\`${extra.when ? ` (${extra.when})` : ''}`),
  ].join(' + ')

  const headerParams = idempotency
    ? z.object({
        'Idempotency-Key': (idempotency === 'required' ? z.string().max(255) : z.string().max(255).optional()).meta({
          description:
            'A unique key per distinct operation (a UUID works), reused only when retrying that same request. Up to 255 characters; stored for 24 hours.',
          examples: ['6f1c2d9e-8a4b-4c3f-9e7d-2b5a1c8f4e30'],
        }),
      })
    : undefined

  return {
    ...rest,
    tags: [tag],
    description: [description, scopeLine, ...(idempotency ? [IDEMPOTENCY_TEXT[idempotency]] : [])].join('\n\n'),
    ...(requestParams || headerParams
      ? { requestParams: { ...requestParams, ...(headerParams ? { header: headerParams } : {}) } }
      : {}),
    'x-required-scope': scope,
  }
}

const TAGS: { name: Tag; 'x-displayName': string; description: string }[] = [
  {
    name: 'Business',
    'x-displayName': 'Business',
    description:
      'Your business profile — the issuer printed on every invoice. Read-only over the API; edit it in Settings.',
  },
  {
    name: 'Customers',
    'x-displayName': 'Customers',
    description:
      'The people and companies you bill. Every invoice references a customer by `cus_…` id. Customers are archived rather than deleted, so issued invoices keep naming who they were billed to.',
  },
  {
    name: 'Products',
    'x-displayName': 'Products',
    description:
      'The things you sell. A product carries a name and description; amounts live on its prices. Archiving sets `active: false` and keeps history intact.',
  },
  {
    name: 'Prices',
    'x-displayName': 'Prices',
    description:
      'Ways to charge for a product: an amount in integer minor units and a currency, one-time or recurring. Bill a price on an invoice line with `price: "price_…"`.',
  },
  {
    name: 'Invoices',
    'x-displayName': 'Invoices',
    description:
      'Invoices move `draft` → `open` (finalize assigns a permanent, consecutive number) → `paid`, or `open` → `void`. Drafts are freely editable and deletable; finalized invoices are frozen. `overdue` is an open invoice past its due date, derived at read time. Operations that spend a number, send email or record payment require an `Idempotency-Key`.',
  },
  {
    name: 'Invoice items',
    'x-displayName': 'Invoice items',
    description:
      'Individual lines of an invoice. Add or remove lines on a draft one at a time; totals are recomputed server-side and the whole invoice is returned.',
  },
  {
    name: 'Webhook endpoints',
    'x-displayName': 'Webhook endpoints',
    description:
      'Register https endpoints to receive invoice events (`invoice.created`, `invoice.finalized`, `invoice.paid`, …). Deliveries are signed per [Standard Webhooks](https://www.standardwebhooks.com/) with `webhook-id`, `webhook-timestamp` and `webhook-signature` headers (HMAC-SHA256 over `{id}.{timestamp}.{body}`); failed deliveries are retried with backoff.',
  },
]

export function buildOpenApiDocument(serverUrl: string) {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Invoice-AI API',
      version: '1.0.0',
      description: [
        'Stripe-shaped invoicing over HTTP: customers, products, prices, invoices and invoice items, with `cus_…`, `prod_…`, `price_…`, `in_…` and `ii_…` ids.',
        '',
        '- **Auth:** `Authorization: Bearer inv_live_…`, with per-key scopes.',
        '- **Envelope:** JSON bodies; responses wrap the resource in `{ "data": … }`; lists add `next_cursor`.',
        '- **Money:** integer minor units of the currency everywhere (`250000` is $2,500.00; ¥5,000 is `5000`).',
        '- **Errors:** RFC 9457 `application/problem+json` — branch on `code`.',
        '- **Idempotency:** operations that spend an invoice number, email or record payment require an `Idempotency-Key`.',
        '- **Rate limits:** 120 requests/minute per key; sending email is limited to 10/hour. See the `RateLimit-*` headers.',
      ].join('\n'),
      contact: { name: 'Invoice-AI support', url: 'https://invoice.horizonpay.co' },
    },
    servers: [{ url: serverUrl, description: 'Production' }],
    tags: TAGS,
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'inv_live_<id>_<secret>',
          description: [
            'An Invoice-AI API key sent as `Authorization: Bearer inv_live_…`.',
            '',
            'Create keys in **Settings → API keys**; the secret is shown once. Each key carries scopes, and every operation lists the scope it needs (`x-required-scope`):',
            '',
            ...SCOPES.map((scope) => `- \`${scope}\` — ${SCOPE_DESCRIPTIONS[scope]}`),
            '',
            'Keys cannot be created or revoked through the API, so a leaked key cannot mint more keys.',
          ].join('\n'),
        },
      },
      headers: componentHeaders,
    },
    security: [{ apiKey: [] }],
    paths: {
      '/business': {
        get: operation({
          operationId: 'getBusiness',
          tag: 'Business',
          summary: 'Retrieve the business profile',
          description:
            'Returns the business profile invoices are issued from: legal name, address, tax id, default currency, bank details and invoice prefix. Read-only — the profile is edited in the app.',
          scope: 'business:read',
          responses: {
            '200': ok('The business profile.', single(businessOut, 'The business profile.'), { data: businessExample }),
            '404': notFound('No business profile yet — onboarding is unfinished.', 'No business profile yet. Finish onboarding first.'),
            ...commonErrors,
          },
        }),
      },

      '/customers': {
        get: operation({
          operationId: 'listCustomers',
          tag: 'Customers',
          summary: 'List customers',
          description:
            'Returns customers newest first, cursor-paginated. Archived customers are excluded unless `include_deleted=true`.',
          scope: 'clients:read',
          requestParams: {
            query: cursorParams.extend({
              query: z.string().optional().meta({ description: 'Case-insensitive substring match on `name`.', examples: ['acme'] }),
              include_deleted: z.boolean().optional().meta({ description: 'Include archived customers. Only the literal `true` enables it.' }),
            }),
          },
          responses: {
            '200': ok('A page of customers.', page(customerOut, 'Customers'), { data: [customerExample], next_cursor: null }),
            '422': invalidCursor,
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createCustomer',
          tag: 'Customers',
          summary: 'Create a customer',
          description:
            'Creates a customer you can bill. Only `name` is required. Creating does not deduplicate — two calls with the same name make two customers.',
          scope: 'clients:write',
          idempotency: 'optional',
          requestBody: json(customerCreateBody, {
            name: 'Acme Industries',
            tax_id: 'US-EIN 12-3456789',
            email: 'ap@acme.example',
            address: { line1: '4th Floor, Market Tower', city: 'Austin', state: 'TX', postal_code: '73301', country: 'US' },
          }),
          responses: {
            '201': ok('The created customer.', single(customerOut, 'The created customer.'), { data: customerExample }, 'optional'),
            '409': problem('A request with the same Idempotency-Key is still running.', [IN_FLIGHT]),
            '422': validationFailed('The body failed validation, or the Idempotency-Key was reused with a different body.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'email', message: 'Enter a valid email' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            ...commonErrors,
          },
        }),
      },

      '/customers/{id}': {
        get: operation({
          operationId: 'retrieveCustomer',
          tag: 'Customers',
          summary: 'Retrieve a customer',
          description: 'Returns one customer by `cus_…` id or UUID, including archived ones (`deleted: true`).',
          scope: 'clients:read',
          requestParams: { path: idParam('The customer, `cus_…` or UUID.', EX.customer) },
          responses: {
            '200': ok('The customer.', single(customerOut, 'The customer.'), { data: customerExample }),
            '404': notFound('No such customer.', 'Client not found.'),
            ...commonErrors,
          },
        }),
        patch: operation({
          operationId: 'updateCustomer',
          tag: 'Customers',
          summary: 'Update a customer',
          description:
            'Updates the fields you send and leaves the rest unchanged. Existing invoices are not affected — each invoice keeps a snapshot of the customer as billed. Naturally idempotent, so no `Idempotency-Key` is needed.',
          scope: 'clients:write',
          requestParams: { path: idParam('The customer, `cus_…` or UUID.', EX.customer) },
          requestBody: json(customerUpdateBody, { phone: '+1 512 555 0100' }),
          responses: {
            '200': ok('The updated customer.', single(customerOut, 'The updated customer.'), {
              data: { ...customerExample, phone: '+1 512 555 0100' },
            }),
            '404': notFound('No such customer.', 'Client not found.'),
            '422': validationFailed('The body failed validation.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'name', message: "Enter your customer's name" }] },
            ]),
            ...commonErrors,
          },
        }),
        delete: operation({
          operationId: 'deleteCustomer',
          tag: 'Customers',
          summary: 'Archive a customer',
          description:
            'Archives the customer (`deleted: true`) instead of deleting it: issued invoices reference customers and must keep naming who they were billed to. Archived customers drop out of `GET /customers` but stay readable by id. Archiving an archived customer succeeds and changes nothing.',
          scope: 'clients:write',
          requestParams: { path: idParam('The customer, `cus_…` or UUID.', EX.customer) },
          responses: {
            '200': ok('The archived customer.', single(customerOut, 'The archived customer.'), {
              data: { ...customerExample, deleted: true },
            }),
            '404': notFound('No such customer.', 'Client not found.'),
            ...commonErrors,
          },
        }),
      },

      '/products': {
        get: operation({
          operationId: 'listProducts',
          tag: 'Products',
          summary: 'List products',
          description: 'Returns products newest first, cursor-paginated. Archived products are included unless you filter with `active`.',
          scope: 'products:read',
          requestParams: {
            query: cursorParams.extend({
              query: z.string().optional().meta({ description: 'Case-insensitive substring match on `name`.', examples: ['consulting'] }),
              active: z.boolean().optional().meta({ description: '`true` for active products only, `false` for archived only. Omit for both.' }),
            }),
          },
          responses: {
            '200': ok('A page of products.', page(productOut, 'Products'), { data: [productExample], next_cursor: null }),
            '422': invalidCursor,
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createProduct',
          tag: 'Products',
          summary: 'Create a product',
          description: 'Creates a product. Add one or more prices to it with `POST /prices` before billing it.',
          scope: 'products:write',
          idempotency: 'optional',
          requestBody: json(productCreateBody, { name: 'Consulting retainer', description: 'Monthly advisory block.' }),
          responses: {
            '201': ok('The created product.', single(productOut, 'The created product.'), { data: productExample }, 'optional'),
            '409': problem('A request with the same Idempotency-Key is still running.', [IN_FLIGHT]),
            '422': validationFailed('The body failed validation, or the Idempotency-Key was reused with a different body.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'name', message: 'Name your product' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            ...commonErrors,
          },
        }),
      },

      '/products/{id}': {
        get: operation({
          operationId: 'retrieveProduct',
          tag: 'Products',
          summary: 'Retrieve a product',
          description: 'Returns one product by `prod_…` id or UUID, whether active or archived.',
          scope: 'products:read',
          requestParams: { path: idParam('The product, `prod_…` or UUID.', EX.product) },
          responses: {
            '200': ok('The product.', single(productOut, 'The product.'), { data: productExample }),
            '404': notFound('No such product.', 'Product not found.'),
            ...commonErrors,
          },
        }),
        patch: operation({
          operationId: 'updateProduct',
          tag: 'Products',
          summary: 'Update a product',
          description:
            'Updates the fields you send and leaves the rest unchanged — omitted fields are never reset to defaults. Send `active: true` to restore an archived product. Finalized invoices keep the line descriptions they were issued with.',
          scope: 'products:write',
          requestParams: { path: idParam('The product, `prod_…` or UUID.', EX.product) },
          requestBody: json(productUpdateBody, { description: 'Monthly advisory block, up to 10 hours.' }),
          responses: {
            '200': ok('The updated product.', single(productOut, 'The updated product.'), {
              data: { ...productExample, description: 'Monthly advisory block, up to 10 hours.', updated: EX.updated },
            }),
            '404': notFound('No such product.', 'Product not found.'),
            '422': validationFailed('The body failed validation.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'images.0', message: 'Enter a valid image URL' }] },
            ]),
            ...commonErrors,
          },
        }),
        delete: operation({
          operationId: 'archiveProduct',
          tag: 'Products',
          summary: 'Archive a product',
          description:
            'Sets `active: false`. The product is not deleted — its prices and the invoice lines that reference it stay intact. Archiving an archived product succeeds and changes nothing. Restore with `PATCH` and `active: true`.',
          scope: 'products:write',
          requestParams: { path: idParam('The product, `prod_…` or UUID.', EX.product) },
          responses: {
            '200': ok('The archived product.', single(productOut, 'The archived product.'), {
              data: { ...productExample, active: false, updated: EX.updated },
            }),
            '404': notFound('No such product.', 'Product not found.'),
            ...commonErrors,
          },
        }),
      },

      '/prices': {
        get: operation({
          operationId: 'listPrices',
          tag: 'Prices',
          summary: 'List prices',
          description:
            'Returns prices newest first, cursor-paginated, optionally filtered by product, active flag, currency or type. An unknown `product` is a `404`, not an empty page.',
          scope: 'products:read',
          requestParams: {
            query: cursorParams.extend({
              product: z.string().optional().meta({ description: 'Only prices of this product, `prod_…` or UUID.', examples: [EX.product] }),
              active: z.boolean().optional().meta({ description: '`true` for active prices only, `false` for archived only. Omit for both.' }),
              currency: z.string().optional().meta({ description: 'ISO 4217 code, case-insensitive.', examples: ['USD'] }),
              type: z.enum(['one_time', 'recurring']).optional().meta({ description: 'Only prices of this type. Other values are ignored.' }),
            }),
          },
          responses: {
            '200': ok('A page of prices.', page(priceOut, 'Prices'), { data: [priceExample], next_cursor: null }),
            '422': invalidCursor,
            '404': notFound('The `product` filter names no product.', 'Product not found.'),
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createPrice',
          tag: 'Prices',
          summary: 'Create a price',
          description:
            'Adds a price to a product. `unit_amount` is integer minor units. A `recurring` price needs `recurring.interval`; it is stored for reporting — nothing auto-bills yet.',
          scope: 'products:write',
          idempotency: 'optional',
          requestBody: json(priceCreateBody, {
            product: EX.product,
            nickname: 'Monthly',
            unit_amount: 2500000,
            currency: 'USD',
            type: 'recurring',
            recurring: { interval: 'month', interval_count: 1 },
            tax_rate: 0,
          }),
          responses: {
            '201': ok('The created price.', single(priceOut, 'The created price.'), { data: priceExample }, 'optional'),
            '404': notFound('`product` names no product.', 'Product not found.'),
            '409': problem('A request with the same Idempotency-Key is still running.', [IN_FLIGHT]),
            '422': validationFailed('The body failed validation, or the Idempotency-Key was reused with a different body.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'recurring_interval', message: 'Pick how often this price recurs' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            ...commonErrors,
          },
        }),
      },

      '/prices/{id}': {
        get: operation({
          operationId: 'retrievePrice',
          tag: 'Prices',
          summary: 'Retrieve a price',
          description: 'Returns one price by `price_…` id or UUID, whether active or archived.',
          scope: 'products:read',
          requestParams: { path: idParam('The price, `price_…` or UUID.', EX.price) },
          responses: {
            '200': ok('The price.', single(priceOut, 'The price.'), { data: priceExample }),
            '404': notFound('No such price.', 'Price not found.'),
            ...commonErrors,
          },
        }),
        patch: operation({
          operationId: 'updatePrice',
          tag: 'Prices',
          summary: 'Update a price',
          description:
            'Updates the fields you send and leaves the rest unchanged. The parent product cannot change — sending `product` is a `422`; create a new price instead. Lines on finalized invoices keep the amount they were billed at; a draft with a line from this price picks up the change the next time it is saved.',
          scope: 'products:write',
          requestParams: { path: idParam('The price, `price_…` or UUID.', EX.price) },
          requestBody: json(priceUpdateBody, {
            nickname: 'Monthly (annual contract)',
            type: 'recurring',
            recurring: { interval: 'month', interval_count: 1 },
          }),
          responses: {
            '200': ok('The updated price.', single(priceOut, 'The updated price.'), {
              data: { ...priceExample, nickname: 'Monthly (annual contract)' },
            }),
            '404': notFound('No such price.', 'Price not found.'),
            '422': validationFailed('The body failed validation, or tried to move the price to another product.', [
              { detail: 'A price cannot move to another product.', errors: [{ path: 'product', message: 'Create a new price on the other product instead.' }] },
            ]),
            ...commonErrors,
          },
        }),
        delete: operation({
          operationId: 'archivePrice',
          tag: 'Prices',
          summary: 'Archive a price',
          description:
            'Sets `active: false`. The price is not deleted, because invoice lines may reference it. Archiving an archived price succeeds and changes nothing. Restore with `PATCH` and `active: true`.',
          scope: 'products:write',
          requestParams: { path: idParam('The price, `price_…` or UUID.', EX.price) },
          responses: {
            '200': ok('The archived price.', single(priceOut, 'The archived price.'), { data: { ...priceExample, active: false } }),
            '404': notFound('No such price.', 'Price not found.'),
            ...commonErrors,
          },
        }),
      },

      '/invoices': {
        get: operation({
          operationId: 'listInvoices',
          tag: 'Invoices',
          summary: 'List invoices',
          description:
            'Returns invoices newest first, cursor-paginated, without `lines`. `status=overdue` selects open invoices whose `due_date` is before today (UTC); `status=open` returns every open invoice, overdue ones included. An unknown `customer` is a `404`.',
          scope: 'invoices:read',
          alsoRequires: [{ scope: 'clients:read', when: 'when filtering by `customer`' }],
          requestParams: {
            query: cursorParams.extend({
              status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).optional().meta({ description: 'Only invoices in this status. Other values are ignored.' }),
              customer: z.string().optional().meta({ description: 'Only invoices billed to this customer, `cus_…` or UUID.', examples: [EX.customer] }),
              from: z.iso.date().optional().meta({ description: 'Only invoices issued on or after this date (`YYYY-MM-DD`).', examples: ['2026-09-01'] }),
              to: z.iso.date().optional().meta({ description: 'Only invoices issued on or before this date (`YYYY-MM-DD`).', examples: ['2026-09-30'] }),
            }),
          },
          responses: {
            '200': ok('A page of invoices (without lines).', page(invoiceOut, 'Invoices'), { data: [openWithoutLines], next_cursor: null }),
            '422': invalidCursor,
            '404': notFound('The `customer` filter names no customer.', 'Client not found.'),
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createInvoice',
          tag: 'Invoices',
          summary: 'Create a draft invoice',
          description: [
            'Creates a `draft` for an existing customer. Each line is either a catalog `price` (description, amount and tax rate are borrowed from it) or an ad-hoc `description` + `unit_amount`. Totals are always computed server-side from the lines. The issue date is today; `currency` defaults to your business currency.',
            'A draft has no number yet — call `POST /invoices/{id}/finalize` (or `/send`) to issue it. Emits `invoice.created`.',
          ].join('\n\n'),
          scope: 'invoices:write',
          alsoRequires: [{ scope: 'business:read' }, { scope: 'clients:read' }],
          idempotency: 'required',
          requestBody: json(invoiceCreateBody, {
            customer: EX.customer,
            currency: 'USD',
            due_date: EX.dueDate,
            description: 'Consulting retainer.',
            items: [
              { price: EX.price, quantity: 1 },
              { description: 'Onboarding workshop', quantity: 1, unit: 'NOS', unit_amount: 50000, tax_rate: 0 },
            ],
          }),
          responses: {
            '201': ok('The created draft, with lines.', single(invoiceOut, 'The created draft.'), { data: draftInvoiceExample }, 'required'),
            '404': notFound('`customer` names no customer, or the business profile is missing.', 'Client not found.'),
            '409': problem('A request with the same Idempotency-Key is still running.', [IN_FLIGHT]),
            '422': validationFailed('The body failed validation (including an unknown price or a currency mismatch), or the Idempotency-Key was reused with a different body.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'items.0.price', message: 'This price is in EUR but the invoice is in USD.' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            '428': idempotencyRequired,
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}': {
        get: operation({
          operationId: 'retrieveInvoice',
          tag: 'Invoices',
          summary: 'Retrieve an invoice',
          description: 'Returns one invoice by `in_…` id or UUID, with its `lines`. `status` reflects `overdue` at the moment of reading.',
          scope: 'invoices:read',
          requestParams: { path: idParam('The invoice, `in_…` or UUID.', EX.invoice) },
          responses: {
            '200': ok('The invoice, with lines.', single(invoiceOut, 'The invoice.'), { data: openInvoiceExample }),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            ...commonErrors,
          },
        }),
        patch: operation({
          operationId: 'updateInvoice',
          tag: 'Invoices',
          summary: 'Update a draft invoice',
          description:
            'Drafts only. A partial update: send only the fields to change — omitted ones (`customer` included) keep their stored value, and `items`, when sent, replaces every line (omit it to keep them). Totals are recomputed and line ids change. Once finalized an invoice is frozen — the customer may already have the PDF — and this returns `409`. Emits `invoice.updated`.',
          scope: 'invoices:write',
          alsoRequires: [{ scope: 'business:read' }, { scope: 'clients:read' }],
          requestParams: { path: idParam('The draft, `in_…` or UUID.', EX.invoice) },
          requestBody: json(invoiceUpdateBody, {
            due_date: EX.dueDate,
            description: 'Consulting retainer — net 30.',
            footer: 'Thank you for your business.',
          }),
          responses: {
            '200': ok('The updated draft, with lines.', single(invoiceOut, 'The updated draft.'), { data: updatedDraftExample }),
            '404': notFound('No such invoice or customer.', 'Invoice not found.'),
            '409': problem('The invoice is no longer a draft.', [
              { code: 'invalid_state', detail: 'This invoice has been finalized and can no longer be edited.' },
            ]),
            '422': validationFailed('The body failed validation.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'due_date', message: 'Invalid ISO date' }] },
            ]),
            ...commonErrors,
          },
        }),
        delete: operation({
          operationId: 'deleteInvoice',
          tag: 'Invoices',
          summary: 'Delete a draft invoice',
          description:
            'Permanently deletes a draft. A finalized invoice can never be deleted — its number belongs to a consecutive series, and a gap reads as a hidden sale. Void it instead.',
          scope: 'invoices:write',
          requestParams: { path: idParam('The draft, `in_…` or UUID.', EX.invoice) },
          responses: {
            '204': noContentResponse('Deleted. No body.'),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice has been finalized.', [
              { code: 'invalid_state', detail: 'Invoice INV-0042 has been finalized and cannot be deleted. Void it instead.' },
            ]),
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}/finalize': {
        post: operation({
          operationId: 'finalizeInvoice',
          tag: 'Invoices',
          summary: 'Finalize an invoice',
          description:
            'Assigns the next permanent number in your series (e.g. `INV-0042`) and moves the draft to `open`. The draft must have at least one line. Finalizing an invoice that already has a number returns it unchanged with the same number — a retry can never burn a second one. Does not email the customer (see `/send`). Emits `invoice.finalized`.',
          scope: 'invoices:finalize',
          idempotency: 'required',
          requestParams: { path: idParam('The draft, `in_…` or UUID.', EX.invoice) },
          responses: {
            '200': ok('The finalized invoice, with its number and lines.', single(invoiceOut, 'The finalized invoice.'), { data: openInvoiceExample }, 'required'),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice has no lines or cannot be finalized from its state, or the same Idempotency-Key is still running.', [
              { code: 'invalid_state', detail: 'invalid_state' },
              IN_FLIGHT,
            ]),
            '422': validationFailed('The Idempotency-Key was reused with a different request.', [IDEMPOTENCY_MISMATCH]),
            '428': idempotencyRequired,
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}/send': {
        post: operation({
          operationId: 'sendInvoice',
          tag: 'Invoices',
          summary: 'Send an invoice',
          description: [
            'Emails the invoice PDF and a link to the public invoice page, via Resend, to `to` or else the customer email recorded on the invoice. A draft is finalized first (this scope covers that — `invoices:finalize` is not needed). Open and paid invoices can be re-sent; void ones cannot.',
            '**Rate limit:** 10 sends per hour per key — each send costs money and lands in a third party’s inbox.',
            'If the email fails after finalizing, the response is `502` and the number stays spent; retry the send. Emits `invoice.emailed` (or `invoice.email_failed`), plus `invoice.finalized` when it finalized.',
          ].join('\n\n'),
          scope: 'invoices:send',
          idempotency: 'required',
          requestParams: { path: idParam('The invoice, `in_…` or UUID.', EX.invoice) },
          requestBody: { ...json(sendBody, { to: 'ap@acme.example' }), required: false },
          responses: {
            '200': ok(
              'Sent. The invoice (finalized if it was a draft, with lines) plus the address it went to.',
              single(invoiceOut, 'The invoice, finalized if it was a draft, with lines.').extend({
                emailed_to: z.string().meta({ description: 'The address the email was sent to: `to`, or the customer email.', examples: ['ap@acme.example'] }),
              }),
              { data: openInvoiceExample, emailed_to: 'ap@acme.example' },
              'required',
            ),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice is void or has no lines, or the same Idempotency-Key is still running.', [
              { code: 'invalid_state', detail: 'This invoice is void and cannot be sent.' },
              { code: 'invalid_state', detail: 'Add at least one line item before sending.' },
              IN_FLIGHT,
            ]),
            '422': validationFailed('No recipient: neither `to` nor a customer email. Or the Idempotency-Key was reused with a different body.', [
              { detail: 'No client email address to send to.', errors: [{ path: 'to', message: 'Provide a recipient, or set an email on the client.' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            '428': idempotencyRequired,
            '429': {
              ...problem('More than 10 sends in an hour for this key. Wait `Retry-After` seconds.', [
                { code: 'rate_limited', detail: 'Rate limit of 10 per 3600s exceeded.' },
              ]),
              headers: rateLimitedResponse.headers,
            },
            '502': problem('The invoice was finalized but the email provider failed. The number is spent; retrying the send is safe.', [
              { code: 'upstream_failed', detail: 'Invoice finalized, but the email failed: Service unavailable' },
            ]),
            '401': unauthorizedResponse,
            '403': forbiddenResponse,
          },
        }),
      },

      '/invoices/{id}/pay': {
        post: operation({
          operationId: 'payInvoice',
          tag: 'Invoices',
          summary: 'Mark an invoice paid',
          description:
            'Records that an `open` (or overdue) invoice was paid outside Invoice-AI — no money moves. Drafts, void and already-paid invoices return `409`. Sets `paid_at` and `amount_due: 0`. The response omits `lines`. Emits `invoice.paid`, with `reference` in the event meta.',
          scope: 'payments:write',
          idempotency: 'required',
          requestParams: { path: idParam('The invoice, `in_…` or UUID.', EX.invoice) },
          requestBody: { ...json(payBody, { paid_on: '2026-09-29', reference: 'chk_123456' }), required: false },
          responses: {
            '200': ok('The paid invoice (without lines).', single(invoiceOut, 'The paid invoice.'), { data: paidInvoiceExample }, 'required'),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice is not open, or the same Idempotency-Key is still running.', [
              { code: 'invalid_state', detail: 'Invoice is draft and cannot be marked paid.' },
              IN_FLIGHT,
            ]),
            '422': validationFailed('The body is not valid JSON, or the Idempotency-Key was reused with a different body.', [IDEMPOTENCY_MISMATCH]),
            '428': idempotencyRequired,
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}/void': {
        post: operation({
          operationId: 'voidInvoice',
          tag: 'Invoices',
          summary: 'Void an invoice',
          description:
            'Voids an `open` (or overdue) invoice with a reason. The number stays on the record — an auditor seeing 0041 then 0043 needs to find 0042 voided, not missing. A paid invoice cannot be voided (it needs a credit note); a draft should be deleted instead. The response omits `lines`. Emits `invoice.voided`.',
          scope: 'invoices:finalize',
          idempotency: 'required',
          requestParams: { path: idParam('The invoice, `in_…` or UUID.', EX.invoice) },
          requestBody: json(voidBody, { reason: 'Raised against the wrong customer.' }),
          responses: {
            '200': ok('The voided invoice (without lines).', single(invoiceOut, 'The voided invoice.'), { data: voidInvoiceExample }, 'required'),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice is not open, or the same Idempotency-Key is still running.', [
              { code: 'invalid_state', detail: 'A paid invoice needs a credit note, not a void.' },
              IN_FLIGHT,
            ]),
            '422': validationFailed('`reason` is missing or blank, or the Idempotency-Key was reused with a different body.', [
              { detail: 'A void reason is required.', errors: [{ path: 'reason', message: 'Say why this invoice is void.' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            '428': idempotencyRequired,
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}/pdf': {
        get: operation({
          operationId: 'retrieveInvoicePdf',
          tag: 'Invoices',
          summary: 'Download an invoice PDF',
          description:
            'Returns the PDF bytes (not a link), rendered on demand from the current invoice, so it is always up to date. Works for drafts too (without a number). Served inline; pass `download=1` for `Content-Disposition: attachment`. Not cacheable (`Cache-Control: private, no-store`).',
          scope: 'invoices:read',
          requestParams: {
            path: idParam('The invoice, `in_…` or UUID.', EX.invoice),
            query: z.object({
              download: z.enum(['1']).optional().meta({ description: '`1` to download as an attachment instead of displaying inline.' }),
            }),
          },
          responses: {
            '200': {
              description: 'The PDF.',
              headers: {
                ...successHeaders,
                'Content-Disposition': {
                  description: '`inline` or `attachment`, with the file name.',
                  schema: { type: 'string', examples: ['inline; filename="INV-0042.pdf"'] },
                },
              },
              content: {
                'application/pdf': { schema: z.string().meta({ description: 'PDF document bytes.', format: 'binary' }) },
              },
            },
            '404': notFound('No such invoice.', 'Invoice not found.'),
            ...commonErrors,
          },
        }),
      },

      '/invoices/{id}/events': {
        get: operation({
          operationId: 'listInvoiceEvents',
          tag: 'Invoices',
          summary: 'List invoice events',
          description:
            'Returns the history of one invoice, newest first, cursor-paginated: created, updated, finalized, emailed, viewed, downloaded, paid, voided. `invoice.viewed` and `invoice.downloaded` are recorded when the customer opens the public link — the way to tell they actually looked at it.',
          scope: 'invoices:read',
          requestParams: { path: idParam('The invoice, `in_…` or UUID.', EX.invoice), query: cursorParams },
          responses: {
            '200': ok('A page of events, newest first.', page(eventOut, 'Events'), { data: eventExamples, next_cursor: null }),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '422': invalidCursor,
            ...commonErrors,
          },
        }),
      },

      '/invoice-items': {
        get: operation({
          operationId: 'listInvoiceItems',
          tag: 'Invoice items',
          summary: 'List invoice items',
          description: 'Returns every line of one invoice, in order (not paginated). `invoice` is required.',
          scope: 'invoices:read',
          requestParams: {
            query: z.object({
              invoice: z.string().meta({ description: 'The invoice, `in_…` or UUID.', examples: [EX.invoice] }),
            }),
          },
          responses: {
            '200': ok(
              'The invoice lines.',
              z.object({ data: z.array(lineItemOut).meta({ description: 'The lines, in order.' }) }),
              { data: [pricedLine, adHocLine] },
            ),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '422': validationFailed('`invoice` is missing.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'invoice', message: 'Pick an invoice' }] },
            ]),
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createInvoiceItem',
          tag: 'Invoice items',
          summary: 'Add an invoice item',
          description:
            'Appends one line to a draft: either a `price`, or `description` + `unit_amount`. Totals are recomputed, so the response is the whole invoice; every line gets a new id. Finalized invoices return `409`. Emits `invoice.updated`.',
          scope: 'invoices:write',
          alsoRequires: [{ scope: 'business:read' }],
          idempotency: 'required',
          requestBody: json(invoiceItemCreateBody, { invoice: EX.invoice, description: 'Extra review round', quantity: 1, unit_amount: 10000 }),
          responses: {
            '201': ok('The whole draft, with the new line last.', single(invoiceOut, 'The updated draft.'), { data: draftWithAddedLine }, 'required'),
            '404': notFound('No such invoice.', 'Invoice not found.'),
            '409': problem('The invoice has been finalized, or the same Idempotency-Key is still running.', [
              { code: 'invalid_state', detail: 'This invoice has been finalized and can no longer be edited.' },
              IN_FLIGHT,
            ]),
            '422': validationFailed('The body failed validation, or the Idempotency-Key was reused with a different body.', [
              { detail: 'Some fields need attention.', errors: [{ path: 'items.2.description', message: 'Describe what you are billing for' }] },
              IDEMPOTENCY_MISMATCH,
            ]),
            '428': idempotencyRequired,
            ...commonErrors,
          },
        }),
      },

      '/invoice-items/{id}': {
        get: operation({
          operationId: 'retrieveInvoiceItem',
          tag: 'Invoice items',
          summary: 'Retrieve an invoice item',
          description: 'Returns one line by `ii_…` id or UUID, from any of your invoices.',
          scope: 'invoices:read',
          requestParams: { path: idParam('The line, `ii_…` or UUID.', EX.line1) },
          responses: {
            '200': ok('The line.', single(lineItemOut, 'The line.'), { data: pricedLine }),
            '404': notFound('No such line.', 'Invoice item not found.'),
            ...commonErrors,
          },
        }),
        delete: operation({
          operationId: 'deleteInvoiceItem',
          tag: 'Invoice items',
          summary: 'Remove an invoice item',
          description:
            'Removes one line from a draft and returns the whole recomputed invoice. A draft always keeps at least one line (`409` for the last one); finalized invoices return `409`. Pass `invoice` to scope the lookup to one invoice. Emits `invoice.updated`.',
          scope: 'invoices:write',
          alsoRequires: [{ scope: 'business:read' }],
          requestParams: {
            path: idParam('The line, `ii_…` or UUID.', EX.line3),
            query: z.object({
              invoice: z.string().optional().meta({ description: 'The invoice the line belongs to, `in_…` or UUID. Speeds up the lookup.', examples: [EX.invoice] }),
            }),
          },
          responses: {
            '200': ok('The updated draft, without the removed line.', single(invoiceOut, 'The updated draft.'), { data: { ...draftInvoiceExample, updated: EX.updated } }),
            '404': notFound('No such line (or invoice).', 'Invoice item not found.'),
            '409': problem('The invoice has been finalized, or this is its only line.', [
              { code: 'invalid_state', detail: 'This invoice has been finalized and can no longer be edited.' },
              { code: 'invalid_state', detail: 'An invoice needs at least one line item.' },
            ]),
            ...commonErrors,
          },
        }),
      },

      '/webhook-endpoints': {
        get: operation({
          operationId: 'listWebhookEndpoints',
          tag: 'Webhook endpoints',
          summary: 'List webhook endpoints',
          description: 'Returns your webhook endpoints, newest first, cursor-paginated. Signing secrets are never included — only once, at creation.',
          scope: 'webhooks:manage',
          requestParams: { query: cursorParams },
          responses: {
            '200': ok('A page of endpoints.', page(webhookEndpointOut, 'Webhook endpoints'), { data: [webhookExample], next_cursor: null }),
            '422': invalidCursor,
            ...commonErrors,
          },
        }),
        post: operation({
          operationId: 'createWebhookEndpoint',
          tag: 'Webhook endpoints',
          summary: 'Create a webhook endpoint',
          description:
            'Registers an https URL to receive events. The response carries the signing `secret` (`whsec_` + base64) — the only time it is returned, so store it. The URL must use https and must not resolve to a private, loopback or link-local address.',
          scope: 'webhooks:manage',
          idempotency: 'optional',
          requestBody: json(webhookCreateBody, {
            url: 'https://example.com/webhooks/invoice-ai',
            events: ['invoice.finalized', 'invoice.paid'],
          }),
          responses: {
            '201': ok(
              'The endpoint, with its signing secret.',
              single(
                webhookEndpointOut.extend({
                  secret: z.string().meta({
                    description: 'Signing secret for verifying `webhook-signature`: `whsec_` followed by standard base64 (Standard Webhooks). Returned only in this response.',
                    examples: ['whsec_Zm9vYmFyYmF6cXV4cXV1eGNvcmdl'],
                  }),
                }),
                'The created endpoint, including its secret.',
              ),
              { data: { ...webhookExample, secret: 'whsec_Zm9vYmFyYmF6cXV4cXV1eGNvcmdl' } },
              'optional',
            ),
            '409': problem('A request with the same Idempotency-Key is still running.', [IN_FLIGHT]),
            '422': validationFailed('The URL is invalid, not https or private, or an event type is unknown.', [
              { detail: 'Webhook URLs must use https.', errors: [{ path: 'url', message: 'Webhook URLs must use https.' }] },
              { detail: 'Unknown event type: invoice.overdue.', errors: [{ path: 'events', message: `Valid types are ${WEBHOOK_EVENTS.join(', ')}.` }] },
            ]),
            ...commonErrors,
          },
        }),
      },

      '/webhook-endpoints/{id}': {
        delete: operation({
          operationId: 'deleteWebhookEndpoint',
          tag: 'Webhook endpoints',
          summary: 'Delete a webhook endpoint',
          description:
            'Permanently deletes the endpoint; no further deliveries are made to it. Deleting it again is a `404`, not a silent success — that usually means you are working from a stale list.',
          scope: 'webhooks:manage',
          requestParams: { path: idParam('The endpoint id (UUID).', EX.webhook) },
          responses: {
            '204': noContentResponse('Deleted. No body.'),
            '404': notFound('No such endpoint.', 'Webhook endpoint not found.'),
            ...commonErrors,
          },
        }),
      },
    },
  })
}

/** Exposed for the docs page and the Postman generator. */
export const SCOPE_LIST = SCOPES.map((scope) => ({
  scope,
  description: SCOPE_DESCRIPTIONS[scope],
}))
