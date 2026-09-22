import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SCOPES } from '@/lib/auth/scopes'

import { buildOpenApiDocument, PRODUCTION_SERVER_URL } from './openapi'

/**
 * The spec is generated from the same zod schemas that validate requests, so
 * most of these tests are about two things: the generator runs at all, and
 * the document stays complete enough to be the published API reference
 * (Mintlify renders api-docs/openapi.json, generated from this function).
 *
 * The route ↔ path checks read app/api/v1 from disk, so adding a route
 * without documenting it — or documenting one that does not exist — fails
 * here rather than in an integrator's generated SDK.
 */
const document = buildOpenApiDocument('https://example.test/api/v1')

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

interface Parameter {
  in: string
  name: string
  required?: boolean
  description?: string
}

interface Operation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Parameter[]
  requestBody?: { content?: Record<string, { schema?: unknown; example?: unknown }> }
  responses?: Record<string, { content?: Record<string, { schema?: unknown; example?: unknown }> }>
  'x-required-scope'?: string
}

const operations = Object.entries(document.paths ?? {}).flatMap(([path, item]) =>
  METHODS.filter((method) => (item as Record<string, unknown>)?.[method]).map((method) => ({
    key: `${method.toUpperCase()} ${path}`,
    path,
    method,
    op: (item as Record<string, Operation>)[method],
  })),
)

// ---------------------------------------------------------------------------
// Route files on disk
// ---------------------------------------------------------------------------

const API_ROOT = resolve(import.meta.dirname, '../../app/api/v1')

interface RouteHandler {
  key: string
  scope: string | null
  idempotent: 'required' | 'optional' | 'none'
}

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return routeFiles(full)
    return entry.name === 'route.ts' ? [full] : []
  })
}

/** Every exported HTTP handler under app/api/v1, with the options it passes to withApi. */
function routeHandlers(): RouteHandler[] {
  return routeFiles(API_ROOT).flatMap((file) => {
    const segments = relative(API_ROOT, file).split(sep).slice(0, -1)
    const path = `/${segments.map((s) => s.replace(/^\[(\w+)\]$/, '{$1}')).join('/')}`
    const source = readFileSync(file, 'utf8')

    const handlers: RouteHandler[] = []
    const exportPattern = /export\s+(?:const|async\s+function|function)\s+(GET|POST|PUT|PATCH|DELETE)\b/g
    for (const match of source.matchAll(exportPattern)) {
      // The options object is the first thing after `withApi(` (or `withApi<P>(`).
      const rest = source.slice(match.index)
      const options = /withApi(?:<[^>]*>)?\(\s*(\{[\s\S]*?\})\s*,/.exec(rest.slice(0, 600))?.[1] ?? ''
      handlers.push({
        key: `${match[1]} ${path}`,
        scope: /scope:\s*'([^']+)'/.exec(options)?.[1] ?? null,
        idempotent: (/idempotent:\s*'(required|optional)'/.exec(options)?.[1] as RouteHandler['idempotent']) ?? 'none',
      })
    }
    return handlers
  })
}

/** Public and unauthenticated on purpose, and describes itself. */
const UNDOCUMENTED = new Set(['GET /openapi.json'])

const handlers = routeHandlers().filter((handler) => !UNDOCUMENTED.has(handler.key))

// ---------------------------------------------------------------------------
// Schema walking
// ---------------------------------------------------------------------------

type Schema = Record<string, unknown>

/** Every property of every object schema reachable from `schema`, with a readable path. */
function* properties(schema: unknown, at: string): Generator<{ at: string; prop: Schema }> {
  if (!schema || typeof schema !== 'object') return
  const s = schema as Schema

  for (const [name, prop] of Object.entries((s.properties as Record<string, Schema>) ?? {})) {
    yield { at: `${at}.${name}`, prop }
    yield* properties(prop, `${at}.${name}`)
  }
  if (s.items) yield* properties(s.items, `${at}[]`)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    for (const [index, branch] of ((s[key] as unknown[]) ?? []).entries()) {
      yield* properties(branch, `${at}.${key}[${index}]`)
    }
  }
}

describe('OpenAPI document', () => {
  it('builds a 3.1 document', () => {
    expect(document.openapi).toBe('3.1.0')
    expect(document.info.title).toBe('Invoice-AI API')
  })

  it('pins the production server URL for the published reference', () => {
    expect(PRODUCTION_SERVER_URL).toBe('https://invoice.horizonpay.co/api/v1')
    expect(buildOpenApiDocument(PRODUCTION_SERVER_URL).servers).toEqual([
      expect.objectContaining({ url: PRODUCTION_SERVER_URL }),
    ])
  })

  it('documents exactly the handlers that exist under app/api/v1', () => {
    // If a route is added under app/api/v1 without being documented, an SDK
    // generated from this spec silently cannot call it; if a documented route
    // is removed, the reference advertises an endpoint that 404s.
    const onDisk = handlers.map((handler) => handler.key).sort()
    const documented = operations.map((operation) => operation.key).sort()

    expect(onDisk.length).toBeGreaterThan(0)
    expect(documented).toEqual(onDisk)
  })

  it('gives every operation a summary, description, unique operationId and a declared tag', () => {
    const declaredTags = new Set((document.tags ?? []).map((tag) => tag.name))
    const ids = new Set<string>()

    for (const { key, op } of operations) {
      expect(op.summary?.trim(), `${key} summary`).toBeTruthy()
      expect(op.description?.trim(), `${key} description`).toBeTruthy()
      expect(op.operationId, `${key} operationId`).toMatch(/^[a-z][A-Za-z]+$/)
      expect(ids.has(op.operationId!), `${key} operationId ${op.operationId} is duplicated`).toBe(false)
      ids.add(op.operationId!)

      expect(op.tags?.length, `${key} tags`).toBe(1)
      for (const tag of op.tags ?? []) expect(declaredTags.has(tag), `${key} tag ${tag}`).toBe(true)
    }
  })

  it('describes every tag', () => {
    for (const tag of document.tags ?? []) {
      expect(tag.description?.trim(), `tag ${tag.name}`).toBeTruthy()
    }
  })

  it('declares the scope each route actually enforces', () => {
    const byKey = new Map(handlers.map((handler) => [handler.key, handler]))

    for (const { key, op } of operations) {
      const handler = byKey.get(key)
      expect(handler?.scope, `${key} has no withApi scope on disk`).toBeTruthy()
      expect(SCOPES).toContain(op['x-required-scope'])
      expect(op['x-required-scope'], key).toBe(handler?.scope)
      expect(op.description, `${key} description names its scope`).toContain(`\`${handler?.scope}\``)
    }
  })

  it('documents the Idempotency-Key header exactly as each route enforces it', () => {
    const byKey = new Map(handlers.map((handler) => [handler.key, handler]))

    for (const { key, op } of operations) {
      const mode = byKey.get(key)?.idempotent ?? 'none'
      const header = op.parameters?.find((p) => p.in === 'header' && p.name === 'Idempotency-Key')

      if (mode === 'none') {
        expect(header, `${key} should not document Idempotency-Key`).toBeUndefined()
      } else {
        expect(header, `${key} should document Idempotency-Key`).toBeDefined()
        expect(Boolean(header?.required), `${key} Idempotency-Key required`).toBe(mode === 'required')
      }
      // 428 is only possible where the key is required.
      expect(Object.keys(op.responses ?? {}).includes('428'), `${key} 428`).toBe(mode === 'required')
    }
  })

  it('describes every parameter', () => {
    for (const { key, op } of operations) {
      for (const param of op.parameters ?? []) {
        expect(param.description?.trim(), `${key} ${param.in} param ${param.name}`).toBeTruthy()
      }
    }
  })

  it('describes every property of every schema', () => {
    const missing: string[] = []

    const check = (schema: unknown, at: string) => {
      for (const { at: where, prop } of properties(schema, at)) {
        if (!(typeof prop.description === 'string' && prop.description.trim())) missing.push(where)
      }
    }

    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      check(schema, `#/components/schemas/${name}`)
    }
    for (const { key, op } of operations) {
      for (const [type, media] of Object.entries(op.requestBody?.content ?? {})) check(media.schema, `${key} body ${type}`)
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        for (const [type, media] of Object.entries(response.content ?? {})) check(media.schema, `${key} ${status} ${type}`)
      }
    }

    expect(missing).toEqual([])
  })

  it('gives every JSON request body and 2xx JSON response an example', () => {
    for (const { key, op } of operations) {
      const body = op.requestBody?.content?.['application/json']
      if (body) expect(body.example, `${key} request example`).toBeDefined()

      for (const [status, response] of Object.entries(op.responses ?? {})) {
        const media = response.content?.['application/json']
        if (/^2/.test(status) && media) expect(media.example, `${key} ${status} example`).toBeDefined()
      }
    }
  })

  it('requires bearer auth by default', () => {
    expect(document.security).toEqual([{ apiKey: [] }])
    expect(document.components?.securitySchemes?.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
  })

  it('declares 428 on every endpoint that spends an invoice number', () => {
    // These are the operations where a retry has a real cost. Losing the 428
    // from the contract would tell integrators the key is optional.
    for (const path of [
      '/invoices',
      '/invoices/{id}/finalize',
      '/invoices/{id}/send',
      '/invoices/{id}/pay',
      '/invoices/{id}/void',
      '/invoice-items',
    ]) {
      const post = (document.paths?.[path] as Record<string, { responses?: object }>)?.post
      expect(Object.keys(post?.responses ?? {}), path).toContain('428')
    }
  })

  it('uses Stripe-style money fields as integers, never decimals', () => {
    const invoice = document.components?.schemas?.Invoice as
      | { properties?: Record<string, { type?: string; format?: string }> }
      | undefined

    // Stripe names: subtotal, discount, taxable, tax, total, amount_due.
    for (const key of ['subtotal', 'discount', 'taxable', 'tax', 'total', 'amount_due']) {
      const prop = invoice?.properties?.[key]
      expect(prop, `${key} should be documented`).toBeDefined()
      expect(prop?.type, `${key} should be an integer`).toBe('integer')
    }

    const price = document.components?.schemas?.Price as
      | { properties?: Record<string, { type?: string }> }
      | undefined
    expect(price?.properties?.unit_amount?.type).toBe('integer')

    const item = document.components?.schemas?.InvoiceItem as
      | { properties?: Record<string, { type?: string }> }
      | undefined
    expect(item?.properties?.unit_amount?.type).toBe('integer')
    expect(item?.properties?.amount?.type).toBe('integer')
  })

  it('describes errors as problem+json with the public problem type URIs', () => {
    for (const { key, op } of operations) {
      for (const [status, response] of Object.entries(op.responses ?? {})) {
        if (/^2/.test(status)) continue
        // Shared responses are $refs to components; those are checked below.
        if ('$ref' in (response as object)) continue
        expect(response.content, `${key} ${status}`).toHaveProperty('application/problem+json')
      }
    }

    for (const response of Object.values(document.components?.responses ?? {})) {
      const media = (response as { content?: Record<string, { examples?: Record<string, { value: { type: string } }> }> })
        .content?.['application/problem+json']
      expect(media).toBeDefined()
      for (const example of Object.values(media?.examples ?? {})) {
        expect(example.value.type).toMatch(/^https:\/\/invoice\.horizonpay\.co\/problems\/[a-z-]+$/)
      }
    }
  })
})
