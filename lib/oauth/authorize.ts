import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import type { Scope } from '@/lib/auth/scopes'
import { deriveKey } from '@/lib/auth/derive-key'
import { MCP_DEFAULT_SCOPES } from '@/lib/mcp/scopes'
import type { ResolvedClient } from '@/lib/oauth/clients'
import { audienceOf, issuer, resourceFor, scopesFor, type Audience } from '@/lib/oauth/config'
import { matchRedirectUri } from '@/lib/oauth/redirect-uri'
import { parseScopeParam } from '@/lib/oauth/scopes'

/**
 * GET /oauth/authorize — reading the request before anyone is asked anything.
 *
 * The order of checks is the OAuth rule that matters most here (RFC 6749
 * §4.1.2.1): until the client and its redirect_uri are verified, an error is
 * SHOWN on our page and never redirected — otherwise /oauth/authorize becomes
 * an open redirect that sends a victim to any URL an attacker writes. Once the
 * redirect_uri is trusted, errors go back to the app, which is waiting there.
 */

export interface AuthorizeRequest {
  client: ResolvedClient
  redirectUri: string
  state: string | null
  codeChallenge: string
  audience: Audience
  resource: string
  /** What the app asked for, limited to what its audience allows. Pre-ticks the consent form. */
  requestedScopes: Scope[]
  /** Everything the consent form may offer for this audience. */
  offeredScopes: readonly Scope[]
}

export type AuthorizeParse =
  | { kind: 'show_error'; message: string }
  | { kind: 'redirect_error'; url: string }
  | { kind: 'ok'; request: AuthorizeRequest }

export async function parseAuthorizeRequest(
  params: URLSearchParams,
  resolveClient: (clientId: string) => Promise<ResolvedClient | { error: string } | null>,
): Promise<AuthorizeParse> {
  // --- 1. who is asking, and where would the answer go? (show errors) -------
  const clientId = params.get('client_id')
  if (!clientId) return show('This sign-in link is missing its client_id. Start again from the app.')

  const client = await resolveClient(clientId)
  if (!client) return show('This app is not registered with Invoice-AI. Start again from the app.')
  if ('error' in client) return show(client.error)

  const requested = params.get('redirect_uri')
  const redirectUri = requested ?? (client.redirectUris.length === 1 ? client.redirectUris[0] : null)
  if (!redirectUri || !matchRedirectUri(redirectUri, client.redirectUris)) {
    return show("This app's return address doesn't match what it registered, so Invoice-AI won't send you back there.")
  }

  // --- 2. the rest of the request (errors go back to the app) --------------
  const state = params.get('state')
  if (state && state.length > 1024) return show('The state parameter is too long.')
  const back = (error: string, description: string) =>
    ({ kind: 'redirect_error', url: authorizeRedirect(redirectUri, { error, error_description: description, state }) }) as const

  if (params.get('response_type') !== 'code') return back('unsupported_response_type', 'Only response_type=code is supported.')
  if (!client.grantTypes.includes('authorization_code')) return back('unauthorized_client', 'This client may not use the authorization code grant.')

  const codeChallenge = params.get('code_challenge') ?? ''
  if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
    return back('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256.')
  }

  // Which of our two APIs the token will be for (RFC 8707). Assistants that
  // don't send `resource` are connecting to the MCP server.
  const audience = params.get('resource') ? audienceOf(params.get('resource')!) : 'mcp'
  if (!audience) return back('invalid_target', 'The resource must be this server’s /mcp or /api/v1 URL.')

  const { scopes, unknown } = parseScopeParam(params.get('scope'))
  if (unknown.length) return back('invalid_scope', `Unknown scope: ${unknown.join(' ')}`)

  const offeredScopes = scopesFor(audience)
  const asked = scopes.filter((s) => offeredScopes.includes(s))
  const requestedScopes = asked.length ? asked : audience === 'mcp' ? [...MCP_DEFAULT_SCOPES] : ['business:read' as Scope]

  return {
    kind: 'ok',
    request: { client, redirectUri, state, codeChallenge, audience, resource: resourceFor(audience), requestedScopes, offeredScopes },
  }
}

/**
 * Back to the app, with `iss` (RFC 9207) so a client talking to several
 * authorization servers can tell which one answered — a defence against
 * mix-up attacks.
 */
export function authorizeRedirect(redirectUri: string, params: Record<string, string | null>): string {
  const url = new URL(redirectUri)
  for (const [key, value] of Object.entries({ ...params, iss: issuer() })) {
    if (value != null) url.searchParams.set(key, value)
  }
  return url.toString()
}

// ---------------------------------------------------------------------------
// The consent token
//
// The consent form posts back the original authorize query plus this token.
// It binds the decision to the user who saw the page and the exact request
// they saw, for ten minutes — so a form posted by another site, or a request
// edited between viewing and approving, is refused.
// ---------------------------------------------------------------------------

const CONSENT_TTL_SECONDS = 10 * 60

export function signConsent(userId: string, query: string, now = Date.now()): string {
  const exp = Math.floor(now / 1000) + CONSENT_TTL_SECONDS
  return `${exp}.${consentSignature(userId, query, exp)}`
}

export function verifyConsent(token: string, userId: string, query: string, now = Date.now()): boolean {
  const match = /^(\d+)\.([A-Za-z0-9_-]+)$/.exec(token)
  if (!match) return false

  const exp = Number(match[1])
  if (exp * 1000 <= now) return false

  const good = Buffer.from(consentSignature(userId, query, exp))
  const given = Buffer.from(match[2])
  return good.length === given.length && timingSafeEqual(good, given)
}

function consentSignature(userId: string, query: string, exp: number): string {
  const request = createHash('sha256').update(query).digest('hex')
  return createHmac('sha256', deriveKey('oauth-consent/v1')).update(`${userId}|${request}|${exp}`).digest('base64url')
}

function show(message: string): AuthorizeParse {
  return { kind: 'show_error', message }
}
