import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ResolvedClient } from './clients'
import { handleDecision, handleRegister, handleRevoke, handleToken, type OAuthDeps, type OAuthStore } from './handlers'
import { signConsent } from './authorize'
import { hashOAuthSecret } from './tokens'

/**
 * The OAuth endpoints with a fake store: every rule that lives in TypeScript
 * (as opposed to inside oauth_redeem_code) is checked here without a database.
 */

const SITE = 'https://invoice.test'
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'

function client(overrides: Partial<ResolvedClient> = {}): ResolvedClient & { expiresAt: string | null } {
  return {
    id: 'client-uuid',
    clientId: 'oc_test',
    kind: 'dcr',
    name: 'Test app',
    clientUri: null,
    redirectUris: ['http://127.0.0.1:8765/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    authMethod: 'none',
    secretHash: null,
    expiresAt: null,
    ...overrides,
  }
}

let store: { [K in keyof OAuthStore]: ReturnType<typeof vi.fn> }
let deps: OAuthDeps

beforeEach(() => {
  process.env.API_KEY_PEPPER = 'test-pepper'
  process.env.NEXT_PUBLIC_SITE_URL = SITE
  store = {
    lookupClient: vi.fn(async (id: string) => (id === 'oc_test' ? client() : null)),
    cacheCimdClient: vi.fn(),
    registerClient: vi.fn(async () => 'created'),
    authorize: vi.fn(),
    redeemCode: vi.fn(async () => ({ outcome: 'ok', grant_id: 'g', owner_id: 'u', scopes: ['invoices:read'], resource: `${SITE}/mcp` })),
    rotateRefresh: vi.fn(async () => ({ outcome: 'ok', grant_id: 'g', owner_id: 'u', scopes: ['invoices:read'], resource: `${SITE}/mcp` })),
    revokeToken: vi.fn(),
  }
  deps = {
    store: store as unknown as OAuthStore,
    rateLimit: async () => ({ ok: true, retryAfter: 0 }),
    fetchMetadata: vi.fn(),
    currentUser: async () => ({ id: 'user-1' }),
    ready: () => true,
    siteOrigin: SITE,
    now: () => Date.now(),
    clientIp: () => '203.0.113.9',
  }
})

const form = (fields: Record<string, string | string[]>, headers: Record<string, string> = {}) => {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) for (const value of [v].flat()) body.append(k, value)
  return new Request(`${SITE}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: body.toString(),
  })
}

describe('POST /oauth/register', () => {
  const register = (body: unknown) =>
    handleRegister(new Request(`${SITE}/oauth/register`, { method: 'POST', body: JSON.stringify(body) }), deps)

  it('registers a public client without a secret', async () => {
    const response = await register({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'], token_endpoint_auth_method: 'none' })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.client_id).toMatch(/^oc_[A-Za-z0-9]{24}$/)
    expect(body.client_secret).toBeUndefined()
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(store.registerClient.mock.calls[0][0]).toMatchObject({ secretHash: null, authMethod: 'none' })
  })

  it('returns a secret once to a confidential client, and stores only its hash', async () => {
    const response = await register({ client_name: 'Backend', redirect_uris: ['https://app.example/cb'] })
    const body = await response.json()

    expect(body.client_secret).toMatch(/^inv_ocs_/)
    expect(store.registerClient.mock.calls[0][0].secretHash).toBe(hashOAuthSecret(body.client_secret))
  })

  it('refuses an unsafe redirect URI', async () => {
    const response = await register({ redirect_uris: ['javascript:alert(1)'] })
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_redirect_uri')
  })
})

describe('POST /oauth/token', () => {
  const exchange = (extra: Record<string, string> = {}, headers: Record<string, string> = {}) =>
    handleToken(
      form(
        {
          grant_type: 'authorization_code',
          code: 'inv_oac_abc',
          code_verifier: 'v'.repeat(43),
          client_id: 'oc_test',
          redirect_uri: 'http://127.0.0.1:8765/callback',
          ...extra,
        },
        headers,
      ),
      deps,
    )

  it('redeems a code for an access and refresh token', async () => {
    const response = await exchange()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'invoices:read' })
    expect(body.access_token).toMatch(/^inv_oat_/)
    expect(body.refresh_token).toMatch(/^inv_ort_/)
    // Only hashes reach the database, and the verifier is checked there.
    const call = store.redeemCode.mock.calls[0][0]
    expect(call.codeHash).toBe(hashOAuthSecret('inv_oac_abc'))
    expect(call.accessHash).toBe(hashOAuthSecret(body.access_token))
    expect(call.codeVerifier).toBe('v'.repeat(43))
  })

  it.each(['invalid', 'reused', 'expired', 'revoked', 'invalid_grant'])('answers %s with one indistinct invalid_grant', async (outcome) => {
    store.redeemCode.mockResolvedValue({ outcome, grant_id: null, owner_id: null, scopes: null, resource: null })
    const response = await exchange()
    expect(response.status).toBe(400)
    expect((await response.json()).error).toBe('invalid_grant')
  })

  it('omits the refresh token for a client without that grant type', async () => {
    store.lookupClient.mockResolvedValue(client({ grantTypes: ['authorization_code'] }))
    const body = await (await exchange()).json()
    expect(body.refresh_token).toBeUndefined()
    expect(store.redeemCode.mock.calls[0][0].refreshHash).toBeNull()
  })

  it('refuses an unknown resource before touching the code', async () => {
    const response = await exchange({ resource: 'https://evil.example/mcp' })
    expect((await response.json()).error).toBe('invalid_target')
    expect(store.redeemCode).not.toHaveBeenCalled()
  })

  it('authenticates a confidential client by its secret, Basic or form', async () => {
    store.lookupClient.mockResolvedValue(client({ authMethod: 'client_secret_basic', secretHash: hashOAuthSecret('inv_ocs_right') }))
    const basic = (secret: string) => ({ authorization: `Basic ${Buffer.from(`oc_test:${secret}`).toString('base64')}` })

    expect((await exchange({}, basic('inv_ocs_right'))).status).toBe(200)

    const wrong = await exchange({}, basic('inv_ocs_wrong'))
    expect(wrong.status).toBe(401)
    expect(wrong.headers.get('www-authenticate')).toContain('Basic')
    expect((await exchange({ client_secret: 'inv_ocs_right' })).status).toBe(200)
  })

  it('rotates a refresh token, narrowing scopes on request', async () => {
    const response = await handleToken(
      form({ grant_type: 'refresh_token', refresh_token: 'inv_ort_old', client_id: 'oc_test', scope: 'invoices:read' }),
      deps,
    )
    expect(response.status).toBe(200)
    expect(store.rotateRefresh.mock.calls[0][0]).toMatchObject({ refreshHash: hashOAuthSecret('inv_ort_old'), scopes: ['invoices:read'] })
  })

  it('reports a reused refresh token as invalid_grant', async () => {
    store.rotateRefresh.mockResolvedValue({ outcome: 'reused', grant_id: null, owner_id: null, scopes: null, resource: null })
    const response = await handleToken(form({ grant_type: 'refresh_token', refresh_token: 'inv_ort_old', client_id: 'oc_test' }), deps)
    expect((await response.json()).error).toBe('invalid_grant')
  })

  it('requires form encoding and a known grant type', async () => {
    const json = new Request(`${SITE}/oauth/token`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect((await (await handleToken(json, deps)).json()).error).toBe('invalid_request')
    expect((await (await handleToken(form({ grant_type: 'password', client_id: 'oc_test' }), deps)).json()).error).toBe(
      'unsupported_grant_type',
    )
  })
})

describe('POST /oauth/revoke', () => {
  it('always answers 200, revoking only for the calling client', async () => {
    const response = await handleRevoke(form({ token: 'inv_oat_x', client_id: 'oc_test' }), deps)
    expect(response.status).toBe(200)
    expect(store.revokeToken).toHaveBeenCalledWith(hashOAuthSecret('inv_oat_x'), 'client-uuid')
  })
})

describe('POST /oauth/authorize/decision', () => {
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: 'oc_test',
    redirect_uri: 'http://127.0.0.1:8765/callback',
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    state: 'xyz',
  }).toString()

  const decide = (fields: Record<string, string | string[]>, headers: Record<string, string> = { origin: SITE }) =>
    handleDecision(
      new Request(`${SITE}/oauth/authorize/decision`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
        body: new URLSearchParams(
          Object.entries({ request: query, consent_token: signConsent('user-1', query), ...fields }).flatMap(([k, v]) =>
            [v].flat().map((value) => [k, value]),
          ),
        ).toString(),
      }),
      deps,
    )

  it('approves: stores the code under the user, with dependencies, and redirects with code, state and iss', async () => {
    const response = await decide({ intent: 'approve', scopes: ['invoices:write'] })
    const location = new URL(response.headers.get('location')!)

    expect(response.status).toBe(303)
    expect(location.origin + location.pathname).toBe('http://127.0.0.1:8765/callback')
    expect(location.searchParams.get('code')).toMatch(/^inv_oac_/)
    expect(location.searchParams.get('state')).toBe('xyz')
    expect(location.searchParams.get('iss')).toBe(SITE)

    const [userId, stored] = store.authorize.mock.calls[0]
    expect(userId).toBe('user-1')
    expect(new Set(stored.scopes)).toEqual(new Set(['invoices:write', 'business:read', 'clients:read', 'invoices:read']))
    expect(stored.codeHash).toBe(hashOAuthSecret(location.searchParams.get('code')!))
    expect(stored.resource).toBe(`${SITE}/mcp`)
  })

  it('denies: tells the app access_denied and stores nothing', async () => {
    const response = await decide({ intent: 'deny' })
    expect(new URL(response.headers.get('location')!).searchParams.get('error')).toBe('access_denied')
    expect(store.authorize).not.toHaveBeenCalled()
  })

  it('never grants a scope the audience does not allow', async () => {
    await decide({ intent: 'approve', scopes: ['invoices:read', 'webhooks:manage'] })
    expect(store.authorize.mock.calls[0][1].scopes).not.toContain('webhooks:manage')
  })

  it('refuses a post from another site', async () => {
    const response = await decide({ intent: 'approve', scopes: ['invoices:read'] }, { origin: 'https://evil.example' })
    expect(response.status).toBe(403)
    expect(store.authorize).not.toHaveBeenCalled()
  })

  it('refuses a request edited after the page was shown', async () => {
    const response = await decide({ intent: 'approve', scopes: ['invoices:read'], request: query.replace('state=xyz', 'state=evil') })
    expect(response.status).toBe(400)
    expect(store.authorize).not.toHaveBeenCalled()
  })

  it('refuses a consent token issued to another user', async () => {
    const response = await decide({ intent: 'approve', scopes: ['invoices:read'], consent_token: signConsent('user-2', query) })
    expect(response.status).toBe(400)
  })
})
