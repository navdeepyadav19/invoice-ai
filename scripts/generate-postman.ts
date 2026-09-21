/**
 * Generate the Postman collection from the OpenAPI document.
 *
 * Generated, not hand-written, for the same reason the OpenAPI document is
 * generated from the zod schemas: a hand-maintained collection is a third copy
 * of the contract, and it is always the one that goes stale first — usually
 * discovered by someone demoing a stale endpoint.
 *
 *   lib/validators.ts → lib/api/openapi.ts → this script → docs/platform/postman/
 *
 * The collection is meant to be run top to bottom (Collection Runner or
 * newman) against a real deployment with every request succeeding. That makes
 * the *order* part of the contract: the spec lists paths by resource, but a
 * run has to create before it reads, edit a draft before finalizing it, and
 * archive the customer only after every invoice that references it is done.
 * So the order is declared explicitly in RUN_ORDER below, and the script
 * refuses to generate if an operation in the spec is missing from it.
 *
 * Run with:  pnpm postman:gen
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildOpenApiDocument } from '../lib/api/openapi'

interface PostmanItem {
  name: string
  request?: Record<string, unknown>
  event?: Record<string, unknown>[]
  item?: PostmanItem[]
  description?: string
}

interface OpenApiParameter {
  in: string
  name: string
  required?: boolean
}

interface OpenApiOperation {
  tags?: string[]
  summary?: string
  description?: string
  parameters?: OpenApiParameter[]
  responses?: Record<string, unknown>
}

interface Operation {
  key: string
  method: string
  path: string
  op: OpenApiOperation
}

/**
 * One request in the run. `key` names the OpenAPI operation; the same
 * operation may appear more than once (three invoices are created, two are
 * finalized), so `name` and `body` can override the defaults per step.
 */
interface Step {
  key: string
  name?: string
  body?: unknown
  /** Extra query params beyond the spec's required ones. */
  query?: Record<string, string>
}

interface Folder {
  name: string
  description: string
  steps: Step[]
}

const OUT_DIR = resolve(import.meta.dirname, '../docs/platform/postman')

const BASE_URL = 'https://invoice.horizonpay.co/api/v1'

/**
 * Resend's test sink: accepts and reports "delivered" without reaching a real
 * inbox. The run sends a real email in production, so it must go somewhere
 * that neither bounces (hurting the sending domain's reputation) nor lands in
 * a stranger's inbox.
 */
const TEST_RECIPIENT = 'delivered@resend.dev'

/**
 * Operations that assign or spend an invoice number. These get a fresh
 * Idempotency-Key per send, and a test asserting the retry replays.
 */
const IDEMPOTENT_OPERATIONS = new Set([
  'POST /invoices',
  'POST /invoices/{id}/finalize',
  'POST /invoices/{id}/send',
  'POST /invoices/{id}/pay',
  'POST /invoices/{id}/void',
  'POST /invoice-items',
])

/**
 * Where each declared query param gets its value. A required param with no
 * entry here fails generation rather than emitting a request that 422s.
 */
const QUERY_VARIABLES: Record<string, string> = {
  invoice: '{{invoice_id}}',
}

/** The description of the line POST /invoice-items adds, so its id can be found. */
const ADDED_LINE_DESCRIPTION = 'Extra review round'

/**
 * Realistic examples, so the collection demos well out of the box.
 */
const EXAMPLE_BODIES: Record<string, unknown> = {
  'POST /customers': {
    name: 'Acme Industries',
    tax_id: 'US-EIN 12-3456789',
    email: TEST_RECIPIENT,
    address: {
      line1: '4th Floor, Market Tower',
      city: 'Austin',
      state: 'TX',
      postal_code: '73301',
      country: 'US',
    },
  },
  'PATCH /customers/{id}': {
    phone: '+1 512 555 0100',
  },
  'POST /products': {
    name: 'Consulting retainer',
    description: 'Monthly advisory block.',
  },
  'PATCH /products/{id}': {
    description: 'Monthly advisory block, up to 10 hours.',
  },
  'POST /prices': {
    product: '{{product_id}}',
    nickname: 'Monthly',
    unit_amount: 2500000,
    currency: 'USD',
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
    tax_rate: 0,
  },
  // The parent product cannot change, so no `product` here. `type` and
  // `recurring` are restated on purpose: the partial wire schema fills in its
  // defaults (`type: 'one_time'`), so a nickname-only PATCH would silently turn
  // this recurring price into a one-off.
  'PATCH /prices/{id}': {
    nickname: 'Monthly (annual contract)',
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1 },
  },
  'POST /invoices': {
    customer: '{{customer_id}}',
    currency: 'USD',
    due_date: '{{due_date}}',
    description: 'Consulting retainer.',
    items: [
      {
        price: '{{price_id}}',
        quantity: 1,
      },
      {
        description: 'Onboarding workshop',
        quantity: 1,
        unit: 'NOS',
        unit_amount: 50000,
        tax_rate: 0,
      },
    ],
  },
  // PATCH validates against the full invoice schema, which requires
  // `customer`. Omitting `items` keeps the draft's existing lines.
  'PATCH /invoices/{id}': {
    customer: '{{customer_id}}',
    due_date: '{{due_date}}',
    description: 'Consulting retainer — net 30.',
    footer: 'Thank you for your business.',
  },
  'POST /invoice-items': {
    invoice: '{{invoice_id}}',
    description: ADDED_LINE_DESCRIPTION,
    quantity: 1,
    unit_amount: 10000,
  },
  'POST /invoices/{id}/send': { to: TEST_RECIPIENT },
  'POST /invoices/{id}/pay': { reference: 'chk_123456' },
  'POST /invoices/{id}/void': { reason: 'Raised against the wrong customer.' },
  'POST /webhook-endpoints': {
    url: 'https://example.com/webhooks/invoice-ai',
    events: ['invoice.finalized', 'invoice.paid'],
  },
}

/**
 * The run, in order. Every OpenAPI operation must appear at least once.
 *
 * Ids are captured into collection variables as they are created, so a later
 * create overwrites `invoice_id` — which is why the delete and void paths run
 * only after the main invoice's lifecycle is finished with it.
 */
const RUN_ORDER: Folder[] = [
  {
    name: '1. Setup',
    description: 'Create and edit the catalogue the invoices bill from.',
    steps: [
      { key: 'GET /business' },
      { key: 'POST /customers' },
      { key: 'GET /customers' },
      { key: 'GET /customers/{id}' },
      { key: 'PATCH /customers/{id}' },
      { key: 'POST /products' },
      { key: 'GET /products' },
      { key: 'GET /products/{id}' },
      { key: 'PATCH /products/{id}' },
      { key: 'POST /prices' },
      { key: 'GET /prices' },
      { key: 'GET /prices/{id}' },
      { key: 'PATCH /prices/{id}' },
      { key: 'POST /webhook-endpoints' },
      { key: 'GET /webhook-endpoints' },
    ],
  },
  {
    name: '2. Draft invoice',
    description: 'A draft is freely editable: no number has been spent on it yet.',
    steps: [
      { key: 'POST /invoices' },
      { key: 'GET /invoices' },
      { key: 'GET /invoices/{id}' },
      { key: 'PATCH /invoices/{id}' },
      { key: 'POST /invoice-items' },
      { key: 'GET /invoice-items' },
      { key: 'GET /invoice-items/{id}' },
      { key: 'DELETE /invoice-items/{id}', query: { invoice: '{{invoice_id}}' } },
    ],
  },
  {
    name: '3. Invoice lifecycle',
    description: `Finalize (spends a number), email it to ${TEST_RECIPIENT}, then mark it paid.`,
    steps: [
      { key: 'POST /invoices/{id}/finalize' },
      { key: 'POST /invoices/{id}/send' },
      { key: 'GET /invoices/{id}/pdf' },
      { key: 'GET /invoices/{id}/events' },
      { key: 'POST /invoices/{id}/pay' },
    ],
  },
  {
    name: '4. Delete & void paths',
    description:
      'A paid invoice cannot be voided and a finalized one cannot be deleted, so each path gets its own fresh invoice.',
    steps: [
      {
        key: 'POST /invoices',
        name: 'Create a throwaway draft',
        body: {
          customer: '{{customer_id}}',
          currency: 'USD',
          description: 'Throwaway draft — deleted by the next request.',
          items: [{ description: 'Placeholder', quantity: 1, unit_amount: 1000, tax_rate: 0 }],
        },
      },
      { key: 'DELETE /invoices/{id}', name: 'Delete the throwaway draft' },
      {
        key: 'POST /invoices',
        name: 'Create a draft to void',
        body: {
          customer: '{{customer_id}}',
          currency: 'USD',
          due_date: '{{due_date}}',
          description: 'Raised by mistake — voided below.',
          items: [{ price: '{{price_id}}', quantity: 1 }],
        },
      },
      { key: 'POST /invoices/{id}/finalize', name: 'Finalize the draft to void' },
      { key: 'POST /invoices/{id}/void' },
    ],
  },
  {
    name: '5. Cleanup',
    description:
      'Customers, products and prices archive rather than delete — issued invoices still reference them.',
    steps: [
      { key: 'DELETE /webhook-endpoints/{id}' },
      { key: 'DELETE /prices/{id}' },
      { key: 'DELETE /products/{id}' },
      { key: 'DELETE /customers/{id}' },
    ],
  },
]

function main(): void {
  const document = buildOpenApiDocument('{{base_url}}')
  const operations = new Map<string, Operation>()

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, never>)) {
      if (!['get', 'post', 'patch', 'delete', 'put'].includes(method)) continue

      const key = `${method.toUpperCase()} ${path}`
      operations.set(key, { key, method, path, op: operation as OpenApiOperation })
    }
  }

  assertOrderCoversSpec(operations)

  const folders: PostmanItem[] = RUN_ORDER.map((folder) => ({
    name: folder.name,
    description: folder.description,
    item: folder.steps.map((step) => buildItem(operations.get(step.key)!, step)),
  }))

  const collection = {
    info: {
      name: 'Invoice-AI API v1',
      description: [
        'Generated from /api/v1/openapi.json — do not edit by hand.',
        'Regenerate with `pnpm postman:gen`.',
        '',
        '## How to run',
        '1. Import both files: this collection and `invoice-ai.postman_environment.json`.',
        '2. Select the "Invoice-AI — production" environment and set `api_key` to a key',
        '   from Settings → API keys (it needs every scope the run touches).',
        '3. Run the whole collection, in order, with the Collection Runner — or:',
        '   `newman run invoice-ai.postman_collection.json -e invoice-ai.postman_environment.json --env-var api_key=…`',
        '',
        'The folders are a lifecycle, not an index: each request depends on ids captured',
        'by the ones before it (stored as collection variables), so running a single',
        'request on its own needs those ids filled in first.',
        '',
        `The run sends one real invoice email, to Resend's test sink ${TEST_RECIPIENT}.`,
        'A fresh Idempotency-Key is injected automatically for every request.',
      ].join('\n'),
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    auth: {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{api_key}}', type: 'string' }],
    },
    event: [
      {
        listen: 'prerequest',
        script: {
          type: 'text/javascript',
          exec: [
            '// A distinct Idempotency-Key per *request*, not per retry loop.',
            '// Reusing one key across different bodies is a 422 by design.',
            "pm.variables.set('idempotency_key', pm.variables.replaceIn('{{$guid}}'));",
            '',
            '// Relative, so the collection does not rot: a due date in the past',
            '// would make every invoice this run creates read as overdue.',
            "pm.variables.set('due_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));",
          ],
        },
      },
    ],
    // Captured ids live here rather than in the environment: `pm.environment.set`
    // silently does nothing when no environment is selected, and an environment
    // value would shadow the collection variable anyway.
    variable: [
      { key: 'base_url', value: BASE_URL },
      { key: 'customer_id', value: '' },
      { key: 'product_id', value: '' },
      { key: 'price_id', value: '' },
      { key: 'webhook_endpoint_id', value: '' },
      { key: 'invoice_id', value: '' },
      { key: 'invoice_item_id', value: '' },
    ],
    item: folders,
  }

  mkdirSync(OUT_DIR, { recursive: true })

  write(`${OUT_DIR}/invoice-ai.postman_collection.json`, collection)
  write(`${OUT_DIR}/invoice-ai.postman_environment.json`, {
    name: 'Invoice-AI — production',
    values: [
      { key: 'base_url', value: BASE_URL, enabled: true },
      // `secret` keeps it out of exports, so a shared environment file cannot
      // leak a working credential.
      { key: 'api_key', value: '', type: 'secret', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  })

  console.log(`Wrote Postman collection with ${countRequests(collection.item)} requests.`)
}

/**
 * A new endpoint added to the spec but not to RUN_ORDER would otherwise just
 * vanish from the collection. Fail the generation instead.
 */
function assertOrderCoversSpec(operations: Map<string, Operation>): void {
  const ordered = new Set(RUN_ORDER.flatMap((folder) => folder.steps.map((step) => step.key)))

  const unknown = [...ordered].filter((key) => !operations.has(key))
  if (unknown.length > 0) {
    throw new Error(`RUN_ORDER names operations the OpenAPI document does not have: ${unknown.join(', ')}`)
  }

  const missing = [...operations.keys()].filter((key) => !ordered.has(key))
  if (missing.length > 0) {
    throw new Error(
      `These OpenAPI operations are not placed in RUN_ORDER (scripts/generate-postman.ts): ${missing.join(', ')}`,
    )
  }
}

function buildItem({ key, method, path, op }: Operation, step: Step): PostmanItem {
  const segments = path.split('/').filter(Boolean)
  const body = step.body ?? EXAMPLE_BODIES[key]
  const query = queryFor(key, op, step)
  const expected = successStatus(key, op)

  const headers: { key: string; value: string }[] = []
  if (body) headers.push({ key: 'Content-Type', value: 'application/json' })
  if (IDEMPOTENT_OPERATIONS.has(key)) {
    headers.push({ key: 'Idempotency-Key', value: '{{idempotency_key}}' })
  }

  const rawPath = path.replace(/\{(\w+)\}/g, (_m, name) => `{{${variableFor(path, name)}}}`)
  const rawQuery = query.length ? `?${query.map((q) => `${q.key}=${q.value}`).join('&')}` : ''

  return {
    name: step.name ?? op.summary ?? key,
    request: {
      method: method.toUpperCase(),
      header: headers,
      description: op.description ?? '',
      url: {
        raw: `{{base_url}}${rawPath}${rawQuery}`,
        host: ['{{base_url}}'],
        path: segments.map((segment) =>
          segment.startsWith('{') ? `{{${variableFor(path, segment.slice(1, -1))}}}` : segment,
        ),
        ...(query.length ? { query } : {}),
      },
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } } : {}),
    },
    event: [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: testsFor(key, expected) },
      },
    ],
  }
}

/**
 * Required query params from the spec (GET /invoice-items needs `?invoice=`),
 * plus any the step adds. Optional spec params are left out — they're filters,
 * and a run should see the unfiltered list.
 */
function queryFor(key: string, op: OpenApiOperation, step: Step): { key: string; value: string }[] {
  const query = new Map<string, string>()

  for (const param of op.parameters ?? []) {
    if (param.in !== 'query' || !param.required) continue
    const value = QUERY_VARIABLES[param.name]
    if (!value) {
      throw new Error(`${key} requires query param "${param.name}", but QUERY_VARIABLES has no value for it.`)
    }
    query.set(param.name, value)
  }
  for (const [name, value] of Object.entries(step.query ?? {})) query.set(name, value)

  return [...query.entries()].map(([name, value]) => ({ key: name, value }))
}

/** The first 2xx response the spec declares: 201 for creates, 204 for hard deletes. */
function successStatus(key: string, op: OpenApiOperation): number {
  const code = Object.keys(op.responses ?? {})
    .filter((status) => /^2\d\d$/.test(status))
    .sort()[0]
  if (!code) throw new Error(`${key} declares no 2xx response, so there is nothing to assert.`)
  return Number(code)
}

/**
 * `{id}` means a different thing under each collection, so it gets a distinct
 * variable per resource. Deriving it from the first path segment means a new
 * resource added later doesn't silently reuse `invoice_id`.
 */
function variableFor(path: string, name: string): string {
  if (name !== 'id') return name

  const resource = path.split('/').filter(Boolean)[0] ?? 'resource'
  // invoices → invoice_id, webhook-endpoints → webhook_endpoint_id
  return `${resource.replace(/-/g, '_').replace(/s$/, '')}_id`
}

/** Store a created resource's id for the requests that follow. */
function capture(variable: string, expected: number, expression = 'pm.response.json().data.id'): string {
  return `if (pm.response.code === ${expected}) pm.collectionVariables.set('${variable}', ${expression});`
}

function testsFor(key: string, expected: number): string[] {
  const tests = [
    `pm.test('status is ${expected}', () => pm.response.to.have.status(${expected}));`,
    "pm.test('is not an auth failure', () => pm.expect(pm.response.code).to.not.be.oneOf([401, 403]));",
    "pm.test('errors are problem+json', () => {",
    '  if (pm.response.code >= 400) {',
    "    pm.expect(pm.response.headers.get('content-type')).to.include('application/problem+json');",
    "    pm.expect(pm.response.json()).to.have.property('code');",
    '  }',
    '});',
    "pm.test('echoes a request id', () => pm.expect(pm.response.headers.get('x-request-id')).to.be.a('string'));",
  ]

  // Capture ids so the collection can be run top to bottom without hand-editing.
  if (key === 'POST /invoices') tests.push(capture('invoice_id', expected))
  if (key === 'POST /customers') tests.push(capture('customer_id', expected))
  if (key === 'POST /products') tests.push(capture('product_id', expected))
  if (key === 'POST /prices') tests.push(capture('price_id', expected))

  if (key === 'POST /webhook-endpoints') {
    tests.push(
      capture('webhook_endpoint_id', expected),
      "pm.test('the secret is returned exactly once, here', () => {",
      `  if (pm.response.code === ${expected}) pm.expect(pm.response.json().data).to.have.property('secret');`,
      '});',
    )
  }

  // The response is the whole invoice, not the line — find the line just added.
  if (key === 'POST /invoice-items') {
    tests.push(
      `if (pm.response.code === ${expected}) {`,
      '  const lines = pm.response.json().data.lines.data;',
      `  const added = lines.find((line) => line.description === '${ADDED_LINE_DESCRIPTION}') || lines[lines.length - 1];`,
      "  pm.collectionVariables.set('invoice_item_id', added.id);",
      '}',
    )
  }

  if (key === 'GET /invoices/{id}/pdf') {
    tests.push(
      "pm.test('is a PDF', () => {",
      `  if (pm.response.code === ${expected}) pm.expect(pm.response.headers.get('content-type')).to.include('application/pdf');`,
      '});',
    )
  }

  if (key === 'POST /invoices/{id}/finalize') {
    tests.push(
      "pm.test('finalizing returns an invoice number', () => {",
      `  if (pm.response.code === ${expected}) {`,
      "    pm.expect(pm.response.json().data.number).to.match(/^[A-Z0-9\\-\\/]{1,16}-\\d{4}$/);",
      '  }',
      '});',
      "// Run this request twice with the SAME Idempotency-Key to see the replay:",
      "// the second response carries Idempotent-Replayed: true and the same number.",
    )
  }

  return tests
}

function countRequests(items: { item?: unknown[] }[]): number {
  return items.reduce((sum, folder) => sum + (folder.item?.length ?? 0), 0)
}

function write(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  console.log(`  ${path.replace(resolve(import.meta.dirname, '..'), '.')}`)
}

main()
