import { timingSafeEqual } from 'node:crypto'

import { isScope, type Scope } from '@/lib/auth/scopes'
import type { OAuthCodeRedemption, OAuthRefreshRotation } from '@/lib/db/rpc'
import {
  cimdCacheSeconds,
  isCimdClientId,
  validateCimdDocument,
  validateRegistration,
  type AuthMethod,
  type ResolvedClient,
} from '@/lib/oauth/clients'
import { authorizeRedirect, parseAuthorizeRequest, verifyConsent } from '@/lib/oauth/authorize'
import { ACCESS_TOKEN_TTL_SECONDS, audienceOf, normaliseResource, REFRESH_TOKEN_TTL_SECONDS } from '@/lib/oauth/config'
import { oauthError, oauthJson } from '@/lib/oauth/errors'
import { expandScopeDependencies, formatScopeParam, parseScopeParam } from '@/lib/oauth/scopes'
import {
  generateAccessToken,
  generateAuthorizationCode,
  generateClientId,
  generateClientSecret,
  generateRefreshToken,
  hashOAuthSecret,
} from '@/lib/oauth/tokens'

/**
 * The authorization server's endpoints, as plain functions of a Request and
 * their dependencies.
 *
 * Nothing here touches the database or the network directly: it all goes
 * through `deps`, so every rule below is unit-tested with fakes
 * (handlers.test.ts), the same way lib/cli-auth/handlers.ts is. The route
 * files only wire in the real dependencies (lib/oauth/store.ts).
 *
 * The security-critical parts of redeeming a code — single use, PKCE,
 * redirect_uri, revoking a stolen code's tokens — happen inside one database
 * function (oauth_redeem_code), atomically. This layer decides what to ask
 * for and how to answer; it can't skip a check.
 */

export interface OAuthStore {
  lookupClient(clientId: string): Promise<(ResolvedClient & { expiresAt: string | null }) | null>
  cacheCimdClient(input: {
    clientId: string
    name: string
    clientUri: string | null
    redirectUris: string[]
    metadata: unknown
    expiresAt: string
  }): Promise<void>
  registerClient(input: {
    clientId: string
    secretHash: string | null
    authMethod: AuthMethod
    name: string
    clientUri: string | null
    redirectUris: string[]
    grantTypes: string[]
    metadata: unknown
  }): Promise<'created' | 'rate_limited'>
  /** Runs as the signed-in user (RLS): upserts their grant and stores the code. */
  authorize(
    userId: string,
    input: { clientUuid: string; scopes: string[]; codeHash: string; redirectUri: string; codeChallenge: string; resource: string },
  ): Promise<void>
  redeemCode(input: {
    codeHash: string
    clientUuid: string
    redirectUri: string
    codeVerifier: string
    resource: string | null
    accessHash: string
    accessExpiresAt: string
    refreshHash: string | null
    refreshExpiresAt: string | null
  }): Promise<OAuthCodeRedemption | null>
  rotateRefresh(input: {
    refreshHash: string
    clientUuid: string
    scopes: string[] | null
    accessHash: string
    accessExpiresAt: string
    newRefreshHash: string
    refreshExpiresAt: string
  }): Promise<OAuthRefreshRotation | null>
  revokeToken(tokenHash: string, clientUuid: string): Promise<void>
}

export interface OAuthDeps {
  store: OAuthStore
  rateLimit: (key: string, limit: number, windowSeconds: number) => Promise<{ ok: boolean; retryAfter: number }>
  fetchMetadata: (url: string) => Promise<{ ok: true; body: unknown; maxAgeSeconds: number | null } | { ok: false; reason: string }>
  /** The signed-in user, for the consent decision. */
  currentUser: () => Promise<{ id: string } | null>
  /** False when the server is missing configuration it needs (API_KEY_PEPPER). */
  ready: () => boolean
  siteOrigin: string
  now: () => number
  clientIp: (request: Request) => string | null
}

// ---------------------------------------------------------------------------
// Resolving a client_id
// ---------------------------------------------------------------------------

export async function resolveClient(
  clientId: string,
  deps: OAuthDeps,
): Promise<ResolvedClient | { error: string } | null> {
  const known = await deps.store.lookupClient(clientId)
  const fresh = known && (known.kind === 'dcr' || (known.expiresAt && Date.parse(known.expiresAt) > deps.now()))
  if (fresh) return known
  if (!isCimdClientId(clientId)) return known

  // A Client ID Metadata Document we haven't seen, or whose cache has lapsed.
  const fetched = await deps.fetchMetadata(clientId)
  if (!fetched.ok) return { error: `Couldn't read this app's details from ${clientId}: ${fetched.reason}` }

  const doc = validateCimdDocument(fetched.body, clientId)
  if (!doc.ok) return { error: doc.description }

  await deps.store.cacheCimdClient({
    clientId,
    name: doc.value.name,
    clientUri: doc.value.clientUri,
    redirectUris: doc.value.redirectUris,
    metadata: fetched.body,
    expiresAt: new Date(deps.now() + cimdCacheSeconds(fetched.maxAgeSeconds) * 1000).toISOString(),
  })
  return deps.store.lookupClient(clientId)
}

// ---------------------------------------------------------------------------
// POST /oauth/register — Dynamic Client Registration (RFC 7591)
// ---------------------------------------------------------------------------

export async function handleRegister(request: Request, deps: OAuthDeps): Promise<Response> {
  if (!deps.ready()) return oauthError('temporarily_unavailable', 'Client registration is not configured on this server.', 503)

  const limit = await deps.rateLimit(`oauth-register:${deps.clientIp(request) ?? 'unknown'}`, 10, 60)
  if (!limit.ok) return oauthError('temporarily_unavailable', 'Too many registrations. Try again shortly.', 429, { 'retry-after': String(limit.retryAfter) })

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return oauthError('invalid_client_metadata', 'The registration must be a JSON object.')
  }

  const registration = validateRegistration(body)
  if (!registration.ok) return oauthError(registration.error, registration.description)
  const r = registration.value

  const clientId = generateClientId()
  const secret = r.authMethod === 'none' ? null : generateClientSecret()

  const outcome = await deps.store.registerClient({
    clientId,
    secretHash: secret ? hashOAuthSecret(secret) : null,
    authMethod: r.authMethod,
    name: r.name,
    clientUri: r.clientUri,
    redirectUris: r.redirectUris,
    grantTypes: r.grantTypes,
    metadata: body,
  })
  if (outcome === 'rate_limited') return oauthError('temporarily_unavailable', 'Too many registrations right now. Try again shortly.', 429)

  return oauthJson(
    {
      client_id: clientId,
      client_id_issued_at: Math.floor(deps.now() / 1000),
      ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
      client_name: r.name,
      ...(r.clientUri ? { client_uri: r.clientUri } : {}),
      redirect_uris: r.redirectUris,
      grant_types: r.grantTypes,
      response_types: ['code'],
      token_endpoint_auth_method: r.authMethod,
    },
    201,
  )
}

// ---------------------------------------------------------------------------
// POST /oauth/token
// ---------------------------------------------------------------------------

export async function handleToken(request: Request, deps: OAuthDeps): Promise<Response> {
  if (!deps.ready()) return oauthError('temporarily_unavailable', 'Token issuing is not configured on this server.', 503)

  const limit = await deps.rateLimit(`oauth-token:${deps.clientIp(request) ?? 'unknown'}`, 60, 60)
  if (!limit.ok) return oauthError('temporarily_unavailable', 'Too many token requests. Slow down.', 429, { 'retry-after': String(limit.retryAfter) })

  const form = await readForm(request)
  if (!form) return oauthError('invalid_request', 'Send the request as application/x-www-form-urlencoded.')

  const client = await authenticateClient(request, form, deps)
  if ('response' in client) return client.response

  switch (form.get('grant_type')) {
    case 'authorization_code':
      return redeemAuthorizationCode(form, client.client, deps)
    case 'refresh_token':
      return rotateRefreshToken(form, client.client, deps)
    default:
      return oauthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.')
  }
}

async function redeemAuthorizationCode(form: URLSearchParams, client: ResolvedClient, deps: OAuthDeps): Promise<Response> {
  const code = form.get('code')
  const redirectUri = form.get('redirect_uri')
  const verifier = form.get('code_verifier')
  if (!code || !redirectUri || !verifier) {
    return oauthError('invalid_request', 'code, redirect_uri and code_verifier are all required.')
  }

  const resourceParam = form.get('resource')
  if (resourceParam && !audienceOf(resourceParam)) return oauthError('invalid_target', 'Unknown resource.')

  const access = generateAccessToken()
  const refresh = client.grantTypes.includes('refresh_token') ? generateRefreshToken() : null
  const now = deps.now()

  const result = await deps.store.redeemCode({
    codeHash: hashOAuthSecret(code),
    clientUuid: client.id,
    redirectUri,
    codeVerifier: verifier,
    resource: resourceParam ? normaliseResource(resourceParam) : null,
    accessHash: hashOAuthSecret(access),
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    refreshHash: refresh ? hashOAuthSecret(refresh) : null,
    refreshExpiresAt: refresh ? new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString() : null,
  })

  if (!result || result.outcome !== 'ok') {
    if (result?.outcome === 'invalid_target') return oauthError('invalid_target', 'The resource does not match the one authorized.')
    // Deliberately one answer for unknown, expired, reused, revoked and a
    // failed PKCE or redirect check: telling them apart helps an attacker
    // more than an app, which can only start again in every case.
    return oauthError('invalid_grant', 'The authorization code is invalid, expired or already used.')
  }

  return tokenResponse(access, refresh, result.scopes ?? [])
}

async function rotateRefreshToken(form: URLSearchParams, client: ResolvedClient, deps: OAuthDeps): Promise<Response> {
  const refreshToken = form.get('refresh_token')
  if (!refreshToken) return oauthError('invalid_request', 'refresh_token is required.')
  if (!client.grantTypes.includes('refresh_token')) return oauthError('unauthorized_client', 'This client may not use refresh tokens.')

  const { scopes, unknown } = parseScopeParam(form.get('scope'))
  if (unknown.length) return oauthError('invalid_scope', `Unknown scope: ${unknown.join(' ')}`)

  const access = generateAccessToken()
  const refresh = generateRefreshToken()
  const now = deps.now()

  const result = await deps.store.rotateRefresh({
    refreshHash: hashOAuthSecret(refreshToken),
    clientUuid: client.id,
    scopes: scopes.length ? scopes : null,
    accessHash: hashOAuthSecret(access),
    accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_SECONDS * 1000).toISOString(),
    newRefreshHash: hashOAuthSecret(refresh),
    refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_SECONDS * 1000).toISOString(),
  })

  if (!result || result.outcome !== 'ok') {
    if (result?.outcome === 'invalid_scope') return oauthError('invalid_scope', 'A refresh can only keep or narrow the scopes granted.')
    return oauthError('invalid_grant', 'The refresh token is invalid, expired, revoked or already used. Sign in again.')
  }

  return tokenResponse(access, refresh, result.scopes ?? [])
}

function tokenResponse(access: string, refresh: string | null, scopes: string[]): Response {
  return oauthJson({
    access_token: access,
    token_type: 'Bearer',
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    ...(refresh ? { refresh_token: refresh } : {}),
    scope: formatScopeParam(scopes),
  })
}

// ---------------------------------------------------------------------------
// POST /oauth/revoke (RFC 7009)
// ---------------------------------------------------------------------------

export async function handleRevoke(request: Request, deps: OAuthDeps): Promise<Response> {
  if (!deps.ready()) return oauthError('temporarily_unavailable', 'Revocation is not configured on this server.', 503)

  const form = await readForm(request)
  if (!form) return oauthError('invalid_request', 'Send the request as application/x-www-form-urlencoded.')

  const client = await authenticateClient(request, form, deps)
  if ('response' in client) return client.response

  const token = form.get('token')
  if (!token) return oauthError('invalid_request', 'token is required.')

  // Always 200, known token or not: a revocation endpoint must not reveal
  // which tokens exist.
  await deps.store.revokeToken(hashOAuthSecret(token), client.client.id)
  return new Response(null, { status: 200, headers: { 'cache-control': 'no-store' } })
}

// ---------------------------------------------------------------------------
// POST /oauth/authorize/decision — the consent form's Approve / Deny
// ---------------------------------------------------------------------------

export async function handleDecision(request: Request, deps: OAuthDeps): Promise<Response> {
  if (!deps.ready()) return page('/oauth/authorize', 'error=unavailable')

  // A cross-site form post must not be able to approve on the user's behalf.
  // Session cookies are SameSite=Lax (not sent on cross-site POSTs); this
  // checks the browser's own word on where the form came from as well.
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if ((origin && origin !== deps.siteOrigin) || (fetchSite && fetchSite !== 'same-origin')) {
    return new Response('Cross-site requests are not accepted here.', { status: 403 })
  }

  const user = await deps.currentUser()
  if (!user) return page('/login', '')

  const form = await readForm(request)
  const query = form?.get('request') ?? ''
  const token = form?.get('consent_token') ?? ''
  if (!form || !verifyConsent(token, user.id, query, deps.now())) {
    return new Response('This approval page expired or was changed. Go back to the app and connect again.', { status: 400 })
  }

  const limit = await deps.rateLimit(`oauth-decision:${user.id}`, 20, 60)
  if (!limit.ok) return new Response('Too many approvals. Wait a minute and try again.', { status: 429 })

  // Re-read the request rather than trusting anything else the form carries.
  const parsed = await parseAuthorizeRequest(new URLSearchParams(query), (id) => resolveClient(id, deps))
  if (parsed.kind === 'show_error') return new Response(parsed.message, { status: 400 })
  if (parsed.kind === 'redirect_error') return seeOther(parsed.url)
  const r = parsed.request

  if (form.get('intent') !== 'approve') {
    return seeOther(authorizeRedirect(r.redirectUri, { error: 'access_denied', error_description: 'The user declined.', state: r.state }))
  }

  const chosen = form.getAll('scopes').filter((s): s is Scope => isScope(s) && r.offeredScopes.includes(s))
  if (!chosen.length) return seeOther(`${deps.siteOrigin}/oauth/authorize?${query}&consent_error=no_scopes`)
  const scopes = expandScopeDependencies(chosen).filter((s) => r.offeredScopes.includes(s))

  const code = generateAuthorizationCode()
  await deps.store.authorize(user.id, {
    clientUuid: r.client.id,
    scopes,
    codeHash: hashOAuthSecret(code),
    redirectUri: r.redirectUri,
    codeChallenge: r.codeChallenge,
    resource: r.resource,
  })

  return seeOther(authorizeRedirect(r.redirectUri, { code, state: r.state }))
}

// ---------------------------------------------------------------------------

/**
 * Who is calling the token or revoke endpoint. Public clients (most MCP
 * clients) send only client_id — PKCE is what protects them. Confidential
 * clients prove themselves with their secret, by HTTP Basic or in the form.
 */
async function authenticateClient(
  request: Request,
  form: URLSearchParams,
  deps: OAuthDeps,
): Promise<{ client: ResolvedClient } | { response: Response }> {
  let clientId = form.get('client_id')
  let secret = form.get('client_secret')
  let viaBasic = false

  const basic = /^Basic\s+(.+)$/i.exec(request.headers.get('authorization') ?? '')
  if (basic) {
    const decoded = Buffer.from(basic[1], 'base64').toString('utf8')
    const colon = decoded.indexOf(':')
    if (colon > 0) {
      clientId = decodeURIComponent(decoded.slice(0, colon))
      secret = decodeURIComponent(decoded.slice(colon + 1))
      viaBasic = true
    }
  }

  const fail = () => ({
    response: oauthError('invalid_client', 'Client authentication failed.', 401, viaBasic ? { 'www-authenticate': 'Basic realm="invoice-ai"' } : {}),
  })

  if (!clientId) return fail()
  const client = await resolveClient(clientId, deps)
  if (!client || 'error' in client) return fail()

  if (client.authMethod === 'none') return { client }
  if (!secret || !client.secretHash) return fail()

  const given = Buffer.from(hashOAuthSecret(secret))
  const stored = Buffer.from(client.secretHash)
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) return fail()

  return { client }
}

async function readForm(request: Request): Promise<URLSearchParams | null> {
  const type = request.headers.get('content-type') ?? ''
  if (!type.includes('application/x-www-form-urlencoded')) return null
  try {
    return new URLSearchParams(await request.text())
  } catch {
    return null
  }
}

function seeOther(url: string): Response {
  return new Response(null, { status: 303, headers: { location: url, 'cache-control': 'no-store' } })
}

function page(path: string, query: string): Response {
  return seeOther(query ? `${path}?${query}` : path)
}
