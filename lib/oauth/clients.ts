import { sanitiseClientField } from '@/lib/cli-auth/device'
import { isValidRedirectUri } from '@/lib/oauth/redirect-uri'

/**
 * Who is asking: the two ways an app can identify itself to us.
 *
 * Client ID Metadata Documents (CIMD, what the MCP spec now prefers). The app's
 * `client_id` IS a URL — say https://claude.ai/oauth/mcp-client.json — and
 * we fetch the JSON there to learn its name and redirect URIs. Nothing to
 * register, and the consent screen can say "Verified domain: claude.ai",
 * because only claude.ai can publish a document at that URL.
 *
 * Dynamic Client Registration (DCR, RFC 7591, kept for older clients). The
 * app POSTs its metadata to /oauth/register and we hand back a random id.
 * Anyone can register anything, so the consent screen marks these apps
 * "Unverified" and shows where the code will be sent.
 */

export type AuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post'

export interface ClientRegistration {
  name: string
  clientUri: string | null
  redirectUris: string[]
  grantTypes: string[]
  authMethod: AuthMethod
}

/** The shape every client takes once resolved, whichever way it identified itself. */
export interface ResolvedClient {
  /** oauth_clients.id — what grants, tokens and audit rows refer to. */
  id: string
  clientId: string
  kind: 'dcr' | 'cimd'
  name: string
  clientUri: string | null
  redirectUris: string[]
  grantTypes: string[]
  authMethod: AuthMethod
  secretHash: string | null
}

const GRANT_TYPES = new Set(['authorization_code', 'refresh_token'])
const AUTH_METHODS = new Set<AuthMethod>(['none', 'client_secret_basic', 'client_secret_post'])

type Validation<T> = { ok: true; value: T } | { ok: false; error: 'invalid_redirect_uri' | 'invalid_client_metadata'; description: string }

/** Validate a DCR request body. Unknown fields are ignored, as RFC 7591 asks. */
export function validateRegistration(body: unknown): Validation<ClientRegistration> {
  if (!body || typeof body !== 'object') return invalid('The registration must be a JSON object.')
  const b = body as Record<string, unknown>

  const redirectUris = b.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length < 1 || redirectUris.length > 10) {
    return { ok: false, error: 'invalid_redirect_uri', description: 'redirect_uris must list 1 to 10 URIs.' }
  }
  const bad = redirectUris.find((uri) => typeof uri !== 'string' || !isValidRedirectUri(uri))
  if (bad !== undefined) {
    return { ok: false, error: 'invalid_redirect_uri', description: `Not an acceptable redirect URI: ${String(bad).slice(0, 200)}` }
  }

  const grantTypes = b.grant_types === undefined ? ['authorization_code', 'refresh_token'] : b.grant_types
  if (!Array.isArray(grantTypes) || !grantTypes.length || grantTypes.some((g) => !GRANT_TYPES.has(g as string))) {
    return invalid('grant_types may contain only authorization_code and refresh_token.')
  }
  if (b.response_types !== undefined && (!Array.isArray(b.response_types) || b.response_types.some((r) => r !== 'code'))) {
    return invalid('response_types may contain only "code".')
  }

  // RFC 7591's default is client_secret_basic; most MCP clients ask for none.
  const authMethod = (b.token_endpoint_auth_method ?? 'client_secret_basic') as AuthMethod
  if (!AUTH_METHODS.has(authMethod)) {
    return invalid('token_endpoint_auth_method must be none, client_secret_basic or client_secret_post.')
  }

  return {
    ok: true,
    value: {
      name: sanitiseClientField(b.client_name) ?? 'Unnamed app',
      clientUri: typeof b.client_uri === 'string' && /^https:\/\//.test(b.client_uri) ? b.client_uri.slice(0, 2048) : null,
      redirectUris: redirectUris as string[],
      grantTypes: grantTypes as string[],
      authMethod,
    },
  }
}

/** A client_id that names a metadata document: https, a path, nothing odd. */
export function isCimdClientId(clientId: string): boolean {
  if (clientId.length > 2048) return false
  try {
    const url = new URL(clientId)
    return (
      url.protocol === 'https:' &&
      url.pathname.length > 1 &&
      !url.hash &&
      !url.username &&
      !url.password &&
      !/\/\.\.?(\/|$)/.test(url.pathname)
    )
  } catch {
    return false
  }
}

/**
 * Validate a fetched Client ID Metadata Document.
 *
 * The document must name itself — `client_id` equal to the URL it came from —
 * or any site could publish a document claiming to be someone else. Only
 * public clients: a document is public, so it can't carry a secret.
 */
export function validateCimdDocument(doc: unknown, url: string): Validation<ClientRegistration> {
  if (!doc || typeof doc !== 'object') return invalid('The client metadata document must be a JSON object.')
  const d = doc as Record<string, unknown>

  if (d.client_id !== url) return invalid('The client metadata document does not name its own URL as client_id.')
  if ('client_secret' in d) return invalid('A client metadata document must not contain a client_secret.')
  if (d.token_endpoint_auth_method !== undefined && d.token_endpoint_auth_method !== 'none') {
    return invalid('Clients identified by a metadata document must use token_endpoint_auth_method "none".')
  }

  // A document describes everything the app can do, not only what we offer:
  // Claude's lists the JWT-bearer grant too. Keep the grants we support and let
  // the rest go unused — the token endpoint only honours what we implement. An
  // app that can't use authorization_code at all is still turned away.
  let grantTypes = d.grant_types
  if (Array.isArray(grantTypes)) {
    grantTypes = grantTypes.filter((g) => GRANT_TYPES.has(g as string))
    if (!(grantTypes as string[]).includes('authorization_code')) {
      return invalid('grant_types must include authorization_code.')
    }
  }

  return validateRegistration({ ...d, grant_types: grantTypes, token_endpoint_auth_method: 'none' })
}

/** How long to trust a fetched document: its own max-age, kept between 5 minutes and a day. */
export function cimdCacheSeconds(maxAge: number | null): number {
  return Math.min(Math.max(maxAge ?? 3600, 300), 86_400)
}

function invalid(description: string): Validation<never> {
  return { ok: false, error: 'invalid_client_metadata', description }
}
