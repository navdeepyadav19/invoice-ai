import { beforeEach, describe, expect, it, vi } from 'vitest'

const afterQueue: Array<() => unknown> = []
vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: (task: () => unknown) => void afterQueue.push(task),
}))
vi.mock('@/lib/db', () => ({ userDb: vi.fn(), anonDb: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))

const claim = vi.fn()
vi.mock('@/lib/db/rpc', () => ({
  claimIdempotencyKey: (...a: unknown[]) => claim(...a),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}))

import { credentialId, runOperation, type OperationCall } from '@/lib/api/pipeline'
import { configureRateLimit } from '@/lib/api/rate-limit'
import type { AuthContext } from '@/lib/auth/context'
import { fakeDb, type FakeDb } from '@/lib/db/testing'
import { ServiceError } from '@/lib/services/errors'

let db: FakeDb

function ctx(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: 'user-1',
    db,
    via: 'oauth',
    scopes: new Set(['invoices:read', 'invoices:finalize']),
    clientId: 'client-uuid',
    grantId: 'grant-1',
    requestId: 'req_1',
    ...overrides,
  } as AuthContext
}

function mcpCall(overrides: Partial<OperationCall> = {}): OperationCall {
  return {
    method: 'MCP',
    route: 'mcp/finalize_invoice',
    startedAt: Date.now(),
    idempotencyKey: null,
    body: async () => '{"invoice_id":"in_1"}',
    clientIp: null,
    ...overrides,
  }
}

const describeResult = () => ({ status: 200, stored: async () => ({ ok: true }) })

beforeEach(() => {
  db = fakeDb()
  afterQueue.length = 0
  claim.mockReset().mockResolvedValue({ outcome: 'claimed' })
  const counts = new Map<string, number>()
  configureRateLimit({
    async hit(key, windowSeconds) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
      return { count: counts.get(key)!, resetAt: Date.now() + windowSeconds * 1000 }
    },
  })
})

describe('credentialId', () => {
  it('uses the API key when there is one', () => {
    expect(credentialId(ctx({ via: 'api_key', apiKeyId: 'key-1', grantId: undefined }))).toBe('key-1')
  })

  it('keys an OAuth call on the grant, never on the shared client id', () => {
    expect(credentialId(ctx())).toBe('oauth:grant-1')
    expect(credentialId(ctx({ grantId: 'grant-2' }))).not.toBe(credentialId(ctx()))
  })

  it('falls back to the user for a browser session', () => {
    expect(credentialId(ctx({ via: 'session', clientId: undefined, grantId: undefined }))).toBe('user-1')
  })
})

describe('runOperation for a non-HTTP caller', () => {
  it('audits an MCP tool call with its method and tool route', async () => {
    const outcome = await runOperation(ctx(), { scope: 'invoices:read' }, mcpCall(), async () => 'ok', describeResult)

    expect(outcome).toMatchObject({ kind: 'done', result: 'ok', status: 200 })
    for (const task of afterQueue) await task()
    const insert = db.queries.find((q) => q.sql.startsWith('insert into "api_requests"'))!
    expect(insert.parameters).toEqual(
      expect.arrayContaining(['MCP', 'mcp/finalize_invoice', 'oauth', 'client-uuid', 200]),
    )
  })

  it('reports a missing scope as a failure without running the operation', async () => {
    const run = vi.fn()
    const outcome = await runOperation(ctx(), { scope: 'invoices:send' }, mcpCall(), run, describeResult)

    expect(outcome.kind).toBe('failed')
    expect((outcome as { error: ServiceError }).error.code).toBe('forbidden')
    expect(run).not.toHaveBeenCalled()
  })

  it('hashes the call body with the tool route, so a different argument is a mismatch', async () => {
    await runOperation(
      ctx(),
      { scope: 'invoices:finalize', idempotent: 'required' },
      mcpCall({ idempotencyKey: 'mcp:finalize:abc' }),
      async () => 'ok',
      describeResult,
    )

    const [, claimed] = claim.mock.calls[0]
    expect(claimed).toMatchObject({ key: 'mcp:finalize:abc', method: 'MCP', path: 'mcp/finalize_invoice' })
  })

  it('returns a replay outcome instead of running twice', async () => {
    claim.mockResolvedValue({ outcome: 'replay', response_status: 200, response_body: { first: true } })
    const run = vi.fn()

    const outcome = await runOperation(
      ctx(),
      { scope: 'invoices:finalize', idempotent: 'required' },
      mcpCall({ idempotencyKey: 'k' }),
      run,
      describeResult,
    )

    expect(outcome).toMatchObject({ kind: 'replayed', status: 200, body: { first: true }, key: 'k' })
    expect(run).not.toHaveBeenCalled()
  })

  it('reports a missing required key without running', async () => {
    const outcome = await runOperation(
      ctx(),
      { scope: 'invoices:finalize', idempotent: 'required' },
      mcpCall(),
      vi.fn(),
      describeResult,
    )

    expect(outcome.kind).toBe('idempotency_key_required')
  })
})
