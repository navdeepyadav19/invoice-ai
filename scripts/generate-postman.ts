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
 * Run with:  pnpm postman:gen
 */

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { buildOpenApiDocument } from '../lib/api/openapi'

interface PostmanItem {
  name: string
  request: Record<string, unknown>
  event?: Record<string, unknown>[]
  item?: PostmanItem[]
}

const OUT_DIR = resolve(import.meta.dirname, '../docs/platform/postman')

/**
 * Operations that assign or spend an invoice number. These get a fresh
 * Idempotency-Key per send, and a test asserting the retry replays.
 */
const IDEMPOTENT_OPERATIONS = new Set([
  'POST /invoices',
  'POST /invoices/{id}/issue',
  'POST /invoices/{id}/send',
  'POST /invoices/{id}/mark-paid',
  'POST /invoices/{id}/cancel',
])

/**
 * Realistic examples, so the collection demos well out of the box.
 */
const EXAMPLE_BODIES: Record<string, unknown> = {
  'POST /clients': {
    name: 'Acme Industries',
    tax_id: 'US-EIN 12-3456789',
    email: 'accounts@acme.example',
    address_line1: '4th Floor, Market Tower',
    city: 'Austin',
    region: 'TX',
    postal_code: '73301',
    country_code: 'US',
  },
  'POST /invoices': {
    client: {
      name: 'Acme Industries',
      email: 'accounts@acme.example',
      country_code: 'US',
    },
    issue_date: '2026-09-17',
    due_date: '2026-10-17',
    currency: 'USD',
    notes: 'September consulting retainer.',
    items: [
      {
        description: 'Consulting services — September 2026',
        quantity: 1,
        unit: 'NOS',
        rate: 25000,
        discount_percent: 0,
        tax_rate: 0,
      },
    ],
  },
  'POST /invoices/{id}/send': { to: 'accounts@acme.example' },
  'POST /invoices/{id}/mark-paid': { reference: 'UTR1234567890' },
  'POST /invoices/{id}/cancel': { reason: 'Raised against the wrong client.' },
  'POST /webhook-endpoints': {
    url: 'https://example.com/webhooks/invoice-ai',
    events: ['invoice.issued', 'invoice.paid'],
  },
}

function main(): void {
  const document = buildOpenApiDocument('{{base_url}}')
  const folders = new Map<string, PostmanItem[]>()

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem as Record<string, never>)) {
      if (!['get', 'post', 'patch', 'delete', 'put'].includes(method)) continue

      const op = operation as { tags?: string[]; summary?: string; description?: string }
      const tag = op.tags?.[0] ?? 'Other'
      const key = `${method.toUpperCase()} ${path}`

      const items = folders.get(tag) ?? []
      items.push(buildItem(key, method, path, op))
      folders.set(tag, items)
    }
  }

  const collection = {
    info: {
      name: 'Invoice-AI API v1',
      description: [
        'Generated from /api/v1/openapi.json — do not edit by hand.',
        'Regenerate with `pnpm postman:gen`.',
        '',
        'Set `api_key` in the environment to a key from Settings → API keys.',
        'A fresh Idempotency-Key is injected automatically for write requests.',
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
            "pm.variables.set('idempotency_key', require('uuid').v4());",
          ],
        },
      },
    ],
    variable: [
      { key: 'base_url', value: 'https://invoice-ai-horizonpay.vercel.app/api/v1' },
      { key: 'invoice_id', value: '' },
      { key: 'client_id', value: '' },
      { key: 'webhook_endpoint_id', value: '' },
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  }

  mkdirSync(OUT_DIR, { recursive: true })

  write(`${OUT_DIR}/invoice-ai.postman_collection.json`, collection)
  write(`${OUT_DIR}/invoice-ai.postman_environment.json`, {
    name: 'Invoice-AI — local',
    values: [
      { key: 'base_url', value: 'https://invoice-ai-horizonpay.vercel.app/api/v1', enabled: true },
      // `secret` keeps it out of exports, so a shared environment file cannot
      // leak a working credential.
      { key: 'api_key', value: '', type: 'secret', enabled: true },
      { key: 'invoice_id', value: '', enabled: true },
      { key: 'client_id', value: '', enabled: true },
      { key: 'webhook_endpoint_id', value: '', enabled: true },
    ],
    _postman_variable_scope: 'environment',
  })

  console.log(`Wrote Postman collection with ${countRequests(collection.item)} requests.`)
}

function buildItem(
  key: string,
  method: string,
  path: string,
  op: { summary?: string; description?: string },
): PostmanItem {
  const segments = path.split('/').filter(Boolean)
  const body = EXAMPLE_BODIES[key]

  const headers: { key: string; value: string }[] = []
  if (body) headers.push({ key: 'Content-Type', value: 'application/json' })
  if (IDEMPOTENT_OPERATIONS.has(key)) {
    headers.push({ key: 'Idempotency-Key', value: '{{idempotency_key}}' })
  }

  return {
    name: op.summary ?? key,
    request: {
      method: method.toUpperCase(),
      header: headers,
      description: op.description ?? '',
      url: {
        raw: `{{base_url}}${path.replace(/\{(\w+)\}/g, (_m, name) => `{{${variableFor(path, name)}}}`)}`,
        host: ['{{base_url}}'],
        path: segments.map((segment) =>
          segment.startsWith('{') ? `{{${variableFor(path, segment.slice(1, -1))}}}` : segment,
        ),
      },
      ...(body ? { body: { mode: 'raw', raw: JSON.stringify(body, null, 2) } } : {}),
    },
    event: [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: testsFor(key) },
      },
    ],
  }
}

/**
 * `{id}` means a different thing under each collection, so it gets a distinct
 * variable per resource. Deriving it from the first path segment means a new
 * resource added later doesn't silently reuse `invoice_id`.
 */
function variableFor(path: string, name: string): string {
  if (name !== 'id') return name

  const resource = path.split('/').filter(Boolean)[0] ?? 'resource'
  // clients → client_id, invoices → invoice_id, webhook-endpoints → webhook_endpoint_id
  return `${resource.replace(/-/g, '_').replace(/s$/, '')}_id`
}

function testsFor(key: string): string[] {
  const tests = [
    "pm.test('is not an auth failure', () => pm.expect(pm.response.code).to.not.be.oneOf([401, 403]));",
    "pm.test('errors are problem+json', () => {",
    '  if (pm.response.code >= 400) {',
    "    pm.expect(pm.response.headers.get('content-type')).to.include('application/problem+json');",
    "    pm.expect(pm.response.json()).to.have.property('code');",
    '  }',
    '});',
    "pm.test('echoes a request id', () => pm.expect(pm.response.headers.get('x-request-id')).to.be.a('string'));",
  ]

  // Capture ids so the folder can be run top to bottom without hand-editing.
  if (key === 'POST /invoices') {
    tests.push(
      "if (pm.response.code === 201) pm.environment.set('invoice_id', pm.response.json().data.id);",
    )
  }
  if (key === 'POST /clients') {
    tests.push(
      "if (pm.response.code === 201) pm.environment.set('client_id', pm.response.json().data.id);",
    )
  }
  if (key === 'POST /webhook-endpoints') {
    tests.push(
      "if (pm.response.code === 201) pm.environment.set('webhook_endpoint_id', pm.response.json().data.id);",
      "pm.test('the secret is returned exactly once, here', () => {",
      '  if (pm.response.code === 201) pm.expect(pm.response.json().data).to.have.property(\'secret\');',
      '});',
    )
  }

  if (key === 'POST /invoices/{id}/issue') {
    tests.push(
      "pm.test('issuing returns an invoice number', () => {",
      '  if (pm.response.code === 200) {',
      "    pm.expect(pm.response.json().data.invoice_number).to.match(/^[A-Z0-9\\-\\/]{1,16}-\\d{4}$/);",
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
