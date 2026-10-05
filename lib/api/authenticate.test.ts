import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({ userDb: vi.fn(() => 'user-db'), anonDb: vi.fn(() => 'anon-db') }))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))

const lookup = vi.fn()
vi.mock('@/lib/db/rpc', () => ({
  oauthTokenLookup: (...a: unknown[]) => lookup(...a),
  oauthTouchGrant: vi.fn(async () => {}),
  apiKeyByPrefix: vi.fn(),
  touchApiKey: vi.fn(),
}))

import { authenticateBearer } from './authenticate'
import { hashOAuthSecret } from '@/lib/oauth/tokens'

const SITE = 'https://invoice.test'

function row(overrides: Record<string, unknown> = {}) {
  return {
    token_id: 't1',
    kind: 'access',
    grant_id: 'grant-1',
    owner_id: 'user-1',
    client_uuid: 'client-1',
    client_name: 'Claude',
    scopes: ['invoices:read', 'invoices:write'],
    resource: `${SITE}/mcp`,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    revoked_at: null,
    grant_scopes: ['invoices:read', 'invoices:write'],
    grant_revoked_at: null,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.API_KEY_PEPPER = 'test-pepper'
  process.env.NEXT_PUBLIC_SITE_URL = SITE
  lookup.mockReset().mockResolvedValue(row())
})

describe('authenticateBearer with an OAuth access token', () => {
  it('builds an oauth context keyed to the grant', async () => {
    const result = await authenticateBearer('inv_oat_abc', 'req_1', { audience: 'mcp' })

    expect(lookup).toHaveBeenCalledWith('anon-db', hashOAuthSecret('inv_oat_abc'))
    expect(result).toMatchObject({
      ok: true,
      ctx: { userId: 'user-1', via: 'oauth', clientId: 'client-1', grantId: 'grant-1', requestId: 'req_1' },
    })
    expect(result.ok && result.expiresAt).toBeGreaterThan(Date.now() / 1000)
  })

  it('narrows the token to the grant as it stands now', async () => {
    lookup.mockResolvedValue(row({ grant_scopes: ['invoices:read'] }))
    const result = await authenticateBearer('inv_oat_abc', 'req_1', { audience: 'mcp' })
    expect(result.ok && [...result.ctx.scopes]).toEqual(['invoices:read'])
  })

  it('refuses a token used at the other audience', async () => {
    const result = await authenticateBearer('inv_oat_abc', 'req_1', { audience: 'api' })
    expect(result).toEqual({ ok: false, detail: 'This token was issued for a different resource.' })
  })

  it.each([
    ['an unknown token', null, 'Invalid access token.'],
    ['a refresh token', row({ kind: 'refresh' }), 'Invalid access token.'],
    ['a revoked token', row({ revoked_at: new Date().toISOString() }), 'This connection was revoked. Reconnect the app to continue.'],
    ['a revoked grant', row({ grant_revoked_at: new Date().toISOString() }), 'This connection was revoked. Reconnect the app to continue.'],
    ['an expired token', row({ expires_at: new Date(Date.now() - 1000).toISOString() }), 'The access token has expired. Refresh it.'],
  ])('refuses %s', async (_label, value, detail) => {
    lookup.mockResolvedValue(value)
    expect(await authenticateBearer('inv_oat_abc', 'req_1', { audience: 'mcp' })).toEqual({ ok: false, detail })
  })

  it('never accepts a refresh token as a bearer credential, without a lookup', async () => {
    const result = await authenticateBearer('inv_ort_abc', 'req_1', { audience: 'mcp' })
    expect(result.ok).toBe(false)
    expect(lookup).not.toHaveBeenCalled()
  })
})
