import { beforeEach, describe, expect, it } from 'vitest'

import { isCimdClientId, validateCimdDocument, validateRegistration, cimdCacheSeconds } from './clients'
import { audienceOf, normaliseResource } from './config'
import { isValidRedirectUri, matchRedirectUri } from './redirect-uri'
import { expandScopeDependencies, parseScopeParam } from './scopes'
import { authorizeRedirect, parseAuthorizeRequest, signConsent, verifyConsent } from './authorize'
import type { ResolvedClient } from './clients'

beforeEach(() => {
  process.env.API_KEY_PEPPER = 'test-pepper'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://invoice.test'
})

describe('redirect URIs', () => {
  it.each([
    ['https://claude.ai/api/mcp/auth_callback', true],
    ['http://127.0.0.1:33418/callback', true],
    ['http://[::1]:8080/cb', true],
    ['http://localhost:6274/oauth/callback', true],
    ['com.example.app:/oauth', true],
    ['http://claude.ai/callback', false], // http only on loopback
    ['javascript:alert(1)', false],
    ['data:text/html,hi', false],
    ['https://claude.ai/cb#frag', false],
    ['https://user:pass@claude.ai/cb', false],
    ['not a url', false],
  ])('%s → %s', (uri, ok) => {
    expect(isValidRedirectUri(uri)).toBe(ok)
  })

  it('matches exactly, except the port on loopback (RFC 8252)', () => {
    expect(matchRedirectUri('https://claude.ai/cb', ['https://claude.ai/cb'])).toBe(true)
    expect(matchRedirectUri('https://claude.ai/cb/', ['https://claude.ai/cb'])).toBe(false)
    expect(matchRedirectUri('http://127.0.0.1:9999/cb', ['http://127.0.0.1:1234/cb'])).toBe(true)
    expect(matchRedirectUri('http://127.0.0.1:9999/other', ['http://127.0.0.1:1234/cb'])).toBe(false)
    expect(matchRedirectUri('http://localhost:9999/cb', ['http://127.0.0.1:1234/cb'])).toBe(false)
  })
})

describe('scopes', () => {
  it('parses a space-separated scope and reports unknown ones', () => {
    expect(parseScopeParam('invoices:read  nonsense invoices:read')).toEqual({ scopes: ['invoices:read'], unknown: ['nonsense'] })
  })

  it('grants what a scope needs to work', () => {
    expect(new Set(expandScopeDependencies(['invoices:write']))).toEqual(
      new Set(['invoices:write', 'business:read', 'clients:read', 'invoices:read']),
    )
    expect(expandScopeDependencies(['invoices:send'])).toContain('invoices:read')
  })
})

describe('resources (audiences)', () => {
  it('recognises our two resources in any harmless spelling', () => {
    expect(audienceOf('https://invoice.test/mcp')).toBe('mcp')
    expect(audienceOf('HTTPS://INVOICE.TEST/mcp/')).toBe('mcp')
    expect(audienceOf('https://invoice.test/api/v1')).toBe('api')
    expect(audienceOf('https://evil.test/mcp')).toBeNull()
    expect(normaliseResource('https://invoice.test/mcp#x')).toBeNull()
  })
})

describe('client registration and metadata documents', () => {
  it('defaults like RFC 7591 and sanitises the name', () => {
    const r = validateRegistration({ client_name: 'My‮App', redirect_uris: ['https://app.example/cb'] })
    expect(r).toMatchObject({ ok: true, value: { authMethod: 'client_secret_basic', grantTypes: ['authorization_code', 'refresh_token'] } })
    expect(r.ok && r.value.name).not.toContain('‮')
  })

  it('refuses bad redirects and grant types', () => {
    expect(validateRegistration({ redirect_uris: [] })).toMatchObject({ ok: false, error: 'invalid_redirect_uri' })
    expect(validateRegistration({ redirect_uris: ['https://a.example/cb'], grant_types: ['password'] })).toMatchObject({
      ok: false,
      error: 'invalid_client_metadata',
    })
  })

  it('accepts only https URLs with a path as CIMD client ids', () => {
    expect(isCimdClientId('https://claude.ai/oauth/client.json')).toBe(true)
    expect(isCimdClientId('https://claude.ai')).toBe(false)
    expect(isCimdClientId('http://claude.ai/client.json')).toBe(false)
    expect(isCimdClientId('oc_abc')).toBe(false)
  })

  it('requires a metadata document to name itself and stay public', () => {
    const url = 'https://claude.ai/oauth/client.json'
    const doc = { client_id: url, client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] }
    expect(validateCimdDocument(doc, url).ok).toBe(true)
    expect(validateCimdDocument({ ...doc, client_id: 'https://other.example/x.json' }, url).ok).toBe(false)
    expect(validateCimdDocument({ ...doc, client_secret: 's' }, url).ok).toBe(false)
    expect(validateCimdDocument({ ...doc, token_endpoint_auth_method: 'private_key_jwt' }, url).ok).toBe(false)
  })

  it('caches a document for between five minutes and a day', () => {
    expect(cimdCacheSeconds(null)).toBe(3600)
    expect(cimdCacheSeconds(10)).toBe(300)
    expect(cimdCacheSeconds(10_000_000)).toBe(86_400)
  })
})

describe('the authorize request', () => {
  const client: ResolvedClient = {
    id: 'client-uuid',
    clientId: 'oc_test',
    kind: 'dcr',
    name: 'Test',
    clientUri: null,
    redirectUris: ['http://127.0.0.1:8765/callback'],
    grantTypes: ['authorization_code', 'refresh_token'],
    authMethod: 'none',
    secretHash: null,
  }
  const challenge = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
  const resolve = async (id: string) => (id === 'oc_test' ? client : null)
  const query = (extra: Record<string, string> = {}) =>
    new URLSearchParams({
      response_type: 'code',
      client_id: 'oc_test',
      redirect_uri: 'http://127.0.0.1:8765/callback',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'xyz',
      ...extra,
    })

  it('shows (never redirects) an error until the client and redirect URI are trusted', async () => {
    expect((await parseAuthorizeRequest(query({ client_id: 'unknown' }), resolve)).kind).toBe('show_error')
    expect((await parseAuthorizeRequest(query({ redirect_uri: 'https://evil.example/cb' }), resolve)).kind).toBe('show_error')
  })

  it('sends later errors back to the app, with state and iss', async () => {
    const result = await parseAuthorizeRequest(query({ code_challenge_method: 'plain' }), resolve)
    expect(result.kind).toBe('redirect_error')
    const url = new URL((result as { url: string }).url)
    expect(url.searchParams.get('error')).toBe('invalid_request')
    expect(url.searchParams.get('state')).toBe('xyz')
    expect(url.searchParams.get('iss')).toBe('https://invoice.test')
  })

  it('refuses a resource that is not ours, and unknown scopes', async () => {
    expect(await parseAuthorizeRequest(query({ resource: 'https://evil.example/mcp' }), resolve)).toMatchObject({ kind: 'redirect_error' })
    const unknown = await parseAuthorizeRequest(query({ scope: 'invoices:read admin' }), resolve)
    expect(new URL((unknown as { url: string }).url).searchParams.get('error')).toBe('invalid_scope')
  })

  it('defaults an assistant to the MCP resource and never offers webhook management', async () => {
    const result = await parseAuthorizeRequest(query({ scope: 'invoices:read webhooks:manage' }), resolve)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.request.resource).toBe('https://invoice.test/mcp')
    expect(result.request.offeredScopes).not.toContain('webhooks:manage')
    expect(result.request.requestedScopes).toEqual(['invoices:read'])
  })

  it('adds iss to every redirect back to the app (RFC 9207)', () => {
    const url = new URL(authorizeRedirect('http://127.0.0.1:8765/callback', { code: 'c', state: null }))
    expect(url.searchParams.get('iss')).toBe('https://invoice.test')
    expect(url.searchParams.has('state')).toBe(false)
  })
})

describe('the consent token', () => {
  it('binds the decision to this user, this exact request, for ten minutes', () => {
    const now = Date.now()
    const token = signConsent('user-1', 'client_id=a&state=x', now)

    expect(verifyConsent(token, 'user-1', 'client_id=a&state=x', now)).toBe(true)
    expect(verifyConsent(token, 'user-2', 'client_id=a&state=x', now)).toBe(false)
    expect(verifyConsent(token, 'user-1', 'client_id=a&state=y', now)).toBe(false)
    expect(verifyConsent(token, 'user-1', 'client_id=a&state=x', now + 11 * 60_000)).toBe(false)
    expect(verifyConsent('garbage', 'user-1', 'client_id=a&state=x', now)).toBe(false)
  })
})
