import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Behaviour lock for withApi.
 *
 * Every /api/v1 route runs through withApi, and the MCP server reuses the same
 * pipeline. These tests pin what a caller can observe — status, headers, body,
 * what gets stored for idempotency, what gets audited — so the pipeline can be
 * restructured without anyone's integration noticing.
 */

const afterQueue: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => void afterQueue.push(task),
}))

// The connection pool is server-only and never reached: every query here goes
// to the fake database on the context.
vi.mock('@/lib/db', () => ({ userDb: vi.fn(), anonDb: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))

const authenticate = vi.fn()
vi.mock('@/lib/api/authenticate', () => ({ authenticate: (...args: unknown[]) => authenticate(...args) }))

const rpc = {
  claimIdempotencyKey: vi.fn(),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}
vi.mock('@/lib/db/rpc', () => ({
  claimIdempotencyKey: (...a: unknown[]) => rpc.claimIdempotencyKey(...a),
  completeIdempotencyKey: (...a: unknown[]) => rpc.completeIdempotencyKey(...a),
  releaseIdempotencyKey: (...a: unknown[]) => rpc.releaseIdempotencyKey(...a),
}))

import { withApi, json } from '@/lib/api/handler'
import { configureRateLimit, type RateLimitStore } from '@/lib/api/rate-limit'
import type { AuthContext } from '@/lib/auth/context'
import type { Scope } from '@/lib/auth/scopes'
import { fakeDb, type FakeDb } from '@/lib/db/testing'
import { ServiceError } from '@/lib/services/errors'

let db: FakeDb

function context(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    db,
    via: 'api_key',
    scopes: new Set<Scope>(['invoices:read', 'invoices:write']),
    apiKeyId: 'key-1',
    requestId: 'req_test',
    ...overrides,
  } as AuthContext
}

/** A store that counts like the real one, so limits can be crossed on demand. */
function countingStore(): RateLimitStore {
  const counts = new Map<string, number>()
  return {
    async hit(key, windowSeconds) {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { count, resetAt: Date.now() + windowSeconds * 1000 }
    },
  }
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('https://invoice.test/api/v1/invoices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  })
}

const route = { params: Promise.resolve({}) }

async function flushAfter(): Promise<void> {
  while (afterQueue.length) await afterQueue.shift()!()
}

/** The api_requests row the pipeline wrote, as column → value. */
function auditRow(): Record<string, unknown> {
  const insert = db.queries.find((q) => q.sql.startsWith('insert into "api_requests"'))
  if (!insert) throw new Error('no audit row was written')
  const columns = /\(([^)]+)\) values/.exec(insert.sql)![1].split(', ').map((c) => c.replaceAll('"', ''))
  return Object.fromEntries(columns.map((c, i) => [c, insert.parameters[i]]))
}

beforeEach(() => {
  db = fakeDb()
  afterQueue.length = 0
  authenticate.mockReset()
  authenticate.mockImplementation(async () => ({ ok: true, ctx: context() }))
  for (const fn of Object.values(rpc)) fn.mockReset()
  rpc.claimIdempotencyKey.mockResolvedValue({ outcome: 'claimed' })
  configureRateLimit(countingStore())
  process.env.API_KEY_PEPPER = 'test-pepper'
})

afterEach(() => {
  delete process.env.API_KEY_PEPPER
})

describe('withApi', () => {
  it('answers 401 problem+json when authentication fails, without running the handler', async () => {
    authenticate.mockResolvedValue({ ok: false, detail: 'Invalid API key.' })
    const handler = vi.fn()

    const response = await withApi({ scope: 'invoices:read' }, handler)(post({}), route)

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('Bearer')
    expect(await response.json()).toMatchObject({ code: 'unauthorized', detail: 'Invalid API key.' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('runs the handler and adds request id and rate-limit headers', async () => {
    const response = await withApi({ scope: 'invoices:read' }, async () => json({ data: 1 }, { status: 200 }))(
      post({}, { 'x-request-id': 'req_from_client' }),
      route,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: 1 })
    expect(response.headers.get('x-request-id')).toBe('req_from_client')
    expect(response.headers.get('ratelimit-limit')).toBe('120')
    expect(response.headers.get('ratelimit-remaining')).toBe('119')
  })

  it('audits one row after the response, with the caller and route', async () => {
    await withApi({ scope: 'invoices:read' }, async () => json({}, { status: 201 }))(post({}), route)
    expect(db.queries.some((q) => q.sql.includes('api_requests'))).toBe(false)

    await flushAfter()

    expect(auditRow()).toMatchObject({
      owner_id: 'user-1',
      via: 'api_key',
      api_key_id: 'key-1',
      client_id: null,
      method: 'POST',
      route: '/api/v1/invoices',
      status: 201,
      idempotency_key: null,
    })
    expect(auditRow().ip_hash).toMatch(/^[0-9a-f]{32}$/)
  })

  it('refuses a missing scope with 403 and never runs the handler', async () => {
    const handler = vi.fn()

    const response = await withApi({ scope: 'invoices:send' }, handler)(post({}), route)

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe('forbidden')
    expect(handler).not.toHaveBeenCalled()
    await flushAfter()
    expect(auditRow().status).toBe(403)
  })

  it('answers 429 with Retry-After once the credential is over its limit', async () => {
    const op = withApi(
      { scope: 'invoices:read', rateLimit: { limit: 1, windowSeconds: 60 }, rateLimitBucket: 'tight' },
      async () => json({}),
    )

    expect((await op(post({}), route)).status).toBe(200)
    const limited = await op(post({}), route)

    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(limited.headers.get('ratelimit-remaining')).toBe('0')
    expect((await limited.json()).code).toBe('rate_limited')
    await flushAfter()
    expect(db.queries.filter((q) => q.sql.includes('api_requests')).at(-1)!.parameters).toContain(429)
  })

  it('keys the rate limit on the API key, so two keys of one owner have separate budgets', async () => {
    const op = withApi({ scope: 'invoices:read', rateLimit: { limit: 1, windowSeconds: 60 }, rateLimitBucket: 'b' }, async () =>
      json({}),
    )

    expect((await op(post({}), route)).status).toBe(200)
    authenticate.mockResolvedValue({ ok: true, ctx: context({ apiKeyId: 'key-2' }) })
    expect((await op(post({}), route)).status).toBe(200)
  })

  it('answers 428 when an idempotency key is required and missing', async () => {
    const handler = vi.fn()

    const response = await withApi({ scope: 'invoices:write', idempotent: 'required' }, handler)(post({}), route)

    expect(response.status).toBe(428)
    expect(handler).not.toHaveBeenCalled()
    await flushAfter()
    expect(auditRow().status).toBe(428)
  })

  it('claims the key, runs once, and stores the successful response', async () => {
    const response = await withApi({ scope: 'invoices:write', idempotent: 'required' }, async () =>
      json({ data: { id: 'in_1' } }, { status: 201 }),
    )(post({ a: 1 }, { 'idempotency-key': 'k-1' }), route)

    expect(response.status).toBe(201)
    const [, claim] = rpc.claimIdempotencyKey.mock.calls[0]
    expect(claim).toMatchObject({ key: 'k-1', method: 'POST', path: '/api/v1/invoices' })
    expect(claim.requestHash).toMatch(/^[0-9a-f]{64}$/)
    expect(rpc.completeIdempotencyKey).toHaveBeenCalledWith(db, 'k-1', 201, { data: { id: 'in_1' } })
    await flushAfter()
    expect(auditRow().idempotency_key).toBe('k-1')
  })

  it('replays a completed key without running the handler, and says so', async () => {
    rpc.claimIdempotencyKey.mockResolvedValue({ outcome: 'replay', response_status: 201, response_body: { data: 'first' } })
    const handler = vi.fn()

    const response = await withApi({ scope: 'invoices:write', idempotent: 'required' }, handler)(
      post({}, { 'idempotency-key': 'k-1' }),
      route,
    )

    expect(response.status).toBe(201)
    expect(response.headers.get('idempotent-replayed')).toBe('true')
    expect(await response.json()).toEqual({ data: 'first' })
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 422 idempotency_mismatch when a key is reused with a different body', async () => {
    rpc.claimIdempotencyKey.mockResolvedValue({ outcome: 'mismatch' })

    const response = await withApi({ scope: 'invoices:write', idempotent: 'optional' }, vi.fn())(
      post({}, { 'idempotency-key': 'k-1' }),
      route,
    )

    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('idempotency_mismatch')
  })

  it('releases the key when the handler answers with an error status', async () => {
    await withApi({ scope: 'invoices:write', idempotent: 'required' }, async () => json({}, { status: 409 }))(
      post({}, { 'idempotency-key': 'k-1' }),
      route,
    )

    expect(rpc.completeIdempotencyKey).not.toHaveBeenCalled()
    expect(rpc.releaseIdempotencyKey).toHaveBeenCalledWith(db, 'k-1')
  })

  it('maps a thrown ServiceError to problem+json and releases the key', async () => {
    const response = await withApi({ scope: 'invoices:write', idempotent: 'required' }, async () => {
      throw new ServiceError('invalid_state', 'This invoice is void.')
    })(post({}, { 'idempotency-key': 'k-1' }), route)

    expect(response.status).toBe(409)
    expect(response.headers.get('x-request-id')).toBeTruthy()
    expect(await response.json()).toMatchObject({ code: 'invalid_state', detail: 'This invoice is void.' })
    expect(rpc.releaseIdempotencyKey).toHaveBeenCalledWith(db, 'k-1')
    await flushAfter()
    expect(auditRow().status).toBe(409)
  })

  it('ignores an idempotency key on operations that do not use one', async () => {
    await withApi({ scope: 'invoices:read' }, async () => json({}))(post({}, { 'idempotency-key': 'k-1' }), route)

    expect(rpc.claimIdempotencyKey).not.toHaveBeenCalled()
  })
})
