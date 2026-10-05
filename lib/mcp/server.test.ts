import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The MCP server over real HTTP requests: the same withBearerAuth +
 * createMcpHandler stack app/mcp/route.ts serves, with the database and the
 * operations replaced by fakes. What's under test is the protocol surface —
 * what a client sees — and the rule that a destructive tool never acts
 * without a confirmation.
 */

vi.mock('next/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/server')>()),
  after: () => {},
}))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ renderInvoicePdf: vi.fn(), pdfFilename: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendInvoiceEmail: vi.fn() }))
vi.mock('@/lib/db', async () => {
  const { fakeDb } = await import('@/lib/db/testing')
  return { userDb: () => fakeDb(), anonDb: () => fakeDb() }
})
vi.mock('@/lib/db/rpc', () => ({
  claimIdempotencyKey: vi.fn(async () => ({ outcome: 'claimed' })),
  completeIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}))

const authenticateBearer = vi.fn()
vi.mock('@/lib/api/authenticate', () => ({ authenticateBearer: (...a: unknown[]) => authenticateBearer(...a) }))

const invoice = {
  id: 'in_1',
  number: null,
  status: 'draft',
  total: 165000,
  amount_due: 0,
  currency: 'USD',
  customer: 'cus_1',
  updated: '2026-10-05T09:00:00.000Z',
  lines: { data: [{}] },
}
const operations = {
  retrieveInvoice: vi.fn(async () => ({ data: invoice })),
  finalizeInvoice: vi.fn(async () => ({ data: { ...invoice, number: 'INV-0001', status: 'open' } })),
}
vi.mock('@/lib/operations/invoices', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/operations/invoices')>()),
  retrieveInvoice: () => operations.retrieveInvoice(),
  finalizeInvoice: () => operations.finalizeInvoice(),
}))

import { createMcpHandler } from 'mcp-handler'

import { configureRateLimit } from '@/lib/api/rate-limit'
import { withBearerAuth } from '@/lib/mcp/auth'
import { INSTRUCTIONS } from '@/lib/mcp/instructions'
import { MCP_SCOPES } from '@/lib/mcp/scopes'
import { registerTools, SERVER_INFO, TOOLS } from '@/lib/mcp/server'

const handler = withBearerAuth(createMcpHandler(registerTools, { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS }))

function authenticateAs(scopes: string[]) {
  authenticateBearer.mockImplementation(async (_token: string, requestId: string) => ({
    ok: true,
    ctx: { userId: 'user-1', via: 'api_key', scopes: new Set(scopes), apiKeyId: 'key-1', requestId },
  }))
}

async function rpc(method: string, params: Record<string, unknown> = {}, token = 'inv_live_test') {
  const response = await handler(
    new Request('https://invoice.test/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-11-25',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  )
  const text = await response.text()
  const json = text.split('\n').find((line) => line.startsWith('{') || line.startsWith('data: {'))
  return { status: response.status, body: json ? JSON.parse(json.replace(/^data: /, '')) : null }
}

beforeEach(() => {
  process.env.API_KEY_PEPPER = 'test-pepper'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://invoice.test'
  configureRateLimit({ hit: async (_key, windowSeconds) => ({ count: 1, resetAt: Date.now() + windowSeconds * 1000 }) })
  authenticateBearer.mockReset()
  operations.retrieveInvoice.mockClear()
  operations.finalizeInvoice.mockClear()
  authenticateAs([...MCP_SCOPES])
})

describe('MCP endpoint', () => {
  it('answers a missing credential with the RFC 9728 challenge', async () => {
    const response = await handler(new Request('https://invoice.test/mcp', { method: 'POST', body: '{}' }))
    const challenge = response.headers.get('www-authenticate') ?? ''

    expect(response.status).toBe(401)
    expect(challenge).toMatch(/^Bearer /)
    expect(challenge).toContain('resource_metadata="https://invoice.test/.well-known/oauth-protected-resource/mcp"')
    expect(challenge).toContain(`scope="${MCP_SCOPES.join(' ')}"`)
  })

  it('answers a rejected credential with the same challenge and the reason', async () => {
    authenticateBearer.mockResolvedValue({ ok: false, detail: 'This API key has been revoked.' })
    const response = await handler(
      new Request('https://invoice.test/mcp', { method: 'POST', headers: { authorization: 'Bearer inv_live_x' }, body: '{}' }),
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('www-authenticate')).toContain('error_description="This API key has been revoked."')
  })

  it('verifies the credential for the MCP audience', async () => {
    await rpc('tools/list')
    expect(authenticateBearer).toHaveBeenCalledWith('inv_live_test', expect.any(String), { audience: 'mcp' })
  })

  it('lists every tool, with every annotation set explicitly', async () => {
    const { body } = await rpc('tools/list')
    const tools = body.result.tools as Array<{ name: string; annotations: Record<string, boolean> }>

    expect(tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name))
    for (const tool of tools) {
      for (const hint of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
        expect(typeof tool.annotations[hint], `${tool.name}.${hint}`).toBe('boolean')
      }
    }
    // Only emailing reaches outside Invoice-AI; only reads are read-only.
    expect(tools.filter((t) => t.annotations.openWorldHint).map((t) => t.name)).toEqual(['send_invoice'])
    expect(tools.find((t) => t.name === 'finalize_invoice')!.annotations.destructiveHint).toBe(true)
  })

  it('never exposes credential management or catalog editing', async () => {
    const { body } = await rpc('tools/list')
    const names = (body.result.tools as Array<{ name: string }>).map((t) => t.name).join(' ')
    expect(names).not.toMatch(/api_key|webhook|create_product|create_price/)
  })

  it('previews a destructive action without performing it', async () => {
    const { body } = await rpc('tools/call', { name: 'finalize_invoice', arguments: { invoice_id: 'in_1' } })

    expect(body.result.isError).toBeFalsy()
    expect(body.result.structuredContent).toMatchObject({ requires_confirmation: true, action: 'finalize' })
    expect(body.result.structuredContent.confirmation_token).toMatch(/^ct_/)
    expect(operations.finalizeInvoice).not.toHaveBeenCalled()
  })

  it('performs it once the preview’s token comes back', async () => {
    const preview = await rpc('tools/call', { name: 'finalize_invoice', arguments: { invoice_id: 'in_1' } })
    const token = preview.body.result.structuredContent.confirmation_token

    const { body } = await rpc('tools/call', { name: 'finalize_invoice', arguments: { invoice_id: 'in_1', confirmation_token: token } })

    expect(body.result.isError).toBeFalsy()
    expect(body.result.content[0].text).toContain('Finalized INV-0001')
    expect(operations.finalizeInvoice).toHaveBeenCalledTimes(1)
  })

  it('refuses a tool outside the connection’s scopes, as a readable tool error', async () => {
    authenticateAs(['invoices:read'])
    const { body } = await rpc('tools/call', { name: 'finalize_invoice', arguments: { invoice_id: 'in_1' } })

    expect(body.result.isError).toBe(true)
    expect(body.result.content[0].text).toMatch(/invoices:finalize.*reconnect/)
    expect(operations.retrieveInvoice).not.toHaveBeenCalled()
  })

  it('tells the model how to work with the tools', async () => {
    const { body } = await rpc('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '0' },
    })

    expect(body.result.serverInfo).toEqual(SERVER_INFO)
    expect(body.result.instructions).toContain('confirmation_token')
  })
})
