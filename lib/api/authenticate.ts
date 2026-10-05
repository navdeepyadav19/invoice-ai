import { anonDb, userDb } from '@/lib/db'
import {
  apiKeyByPrefix,
  oauthTokenLookup,
  oauthTouchGrant,
  touchApiKey,
  type ApiKeyLookup,
  type OAuthTokenLookup,
} from '@/lib/db/rpc'
import { normaliseResource, resourceFor } from '@/lib/oauth/config'
import { hashOAuthSecret } from '@/lib/oauth/tokens'
import { checkValidity, parseApiKey, secretMatches } from '@/lib/auth/api-key'
import { parseScopes } from '@/lib/auth/scopes'
import type { AuthContext } from '@/lib/auth/context'

/**
 * Turn an Authorization header into an AuthContext, or explain why not.
 *
 * Returns a result object instead of throwing because every failure here is an
 * ordinary 401 that arrives constantly from scanners and misconfigured clients.
 * Exceptions are for the unexpected; a wrong password is not unexpected.
 */

export type AuthResult =
  /** `expiresAt` (unix seconds) is set for credentials that expire on their own, like OAuth access tokens. */
  | { ok: true; ctx: AuthContext; expiresAt?: number }
  | { ok: false; detail: string }

/**
 * Which door the credential is being presented at.
 *
 * API keys work at both. OAuth access tokens are bound to one audience when
 * they're issued (RFC 8707): a token minted for an assistant's MCP connection
 * must not double as a REST credential, and vice versa — otherwise handing an
 * assistant "drafts" access would quietly hand every script it writes the same.
 */
export type Audience = 'api' | 'mcp'

export interface AuthenticateOptions {
  audience: Audience
}

export async function authenticate(
  request: Request,
  requestId: string,
  options: AuthenticateOptions = { audience: 'api' },
): Promise<AuthResult> {
  const header = request.headers.get('authorization')

  if (!header) {
    return { ok: false, detail: 'Send your API key as `Authorization: Bearer inv_live_…`.' }
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) {
    return { ok: false, detail: 'Authorization header must use the Bearer scheme.' }
  }

  return authenticateBearer(match[1].trim(), requestId, options)
}

/**
 * The credential itself, already taken out of its header. The MCP route needs
 * this form: its auth wrapper has parsed the header before calling us.
 *
 * Credentials are told apart by prefix, which is also what lets secret
 * scanners recognise a leaked one:
 *
 *   inv_live_…   API key                 any audience
 *   inv_oat_…    OAuth access token      the audience it was issued for
 *   inv_ort_…    OAuth refresh token     never a bearer credential
 */
export async function authenticateBearer(
  token: string,
  requestId: string,
  options: AuthenticateOptions = { audience: 'api' },
): Promise<AuthResult> {
  if (token.startsWith('inv_live_')) return authenticateApiKey(token, requestId)

  if (token.startsWith('inv_ort_')) {
    return { ok: false, detail: 'A refresh token cannot be used as a bearer credential. Exchange it at /oauth/token.' }
  }

  if (token.startsWith('inv_oat_')) return authenticateOAuth(token, requestId, options.audience)

  return { ok: false, detail: 'Unrecognised credential. Expected an Invoice-AI API key or OAuth access token.' }
}

/**
 * An OAuth access token: issued to a connected app (Claude, ChatGPT…) after
 * the user approved it on the consent screen.
 *
 * Checked in the order that keeps answers honest without helping a guesser:
 * the token must exist and be an access token before we say anything more
 * specific than "invalid".
 */
async function authenticateOAuth(token: string, requestId: string, audience: Audience): Promise<AuthResult> {
  let row: OAuthTokenLookup | null
  try {
    row = await oauthTokenLookup(anonDb(), hashOAuthSecret(token))
  } catch (cause) {
    console.error('[api] oauth token lookup failed on %s', requestId, cause)
    return { ok: false, detail: 'Could not verify the access token.' }
  }

  if (!row || row.kind !== 'access') return { ok: false, detail: 'Invalid access token.' }
  if (row.revoked_at || row.grant_revoked_at) {
    return { ok: false, detail: 'This connection was revoked. Reconnect the app to continue.' }
  }
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, detail: 'The access token has expired. Refresh it.' }

  // Audience binding (RFC 8707): a token for the MCP server is not an API key.
  if (normaliseResource(row.resource) !== resourceFor(audience)) {
    return { ok: false, detail: 'This token was issued for a different resource.' }
  }

  // What the token says it may do, narrowed by the grant as it stands now —
  // so removing a permission from a connection takes effect immediately.
  const scopes = parseScopes(row.scopes).filter((scope) => row.grant_scopes.includes(scope))
  if (!scopes.length) return { ok: false, detail: 'This connection has no usable permissions left.' }

  void oauthTouchGrant(anonDb(), row.grant_id).catch(() => {})

  return {
    ok: true,
    expiresAt: Math.floor(Date.parse(row.expires_at) / 1000),
    ctx: {
      userId: row.owner_id,
      db: userDb(row.owner_id),
      via: 'oauth',
      scopes: new Set(scopes),
      clientId: row.client_uuid,
      grantId: row.grant_id,
      requestId,
    },
  }
}

async function authenticateApiKey(token: string, requestId: string): Promise<AuthResult> {
  const parsed = parseApiKey(token)

  // Deliberately the same message as a wrong secret below. Distinguishing
  // "malformed" from "no such key" from "wrong secret" tells an attacker which
  // half of a guess was right.
  if (!parsed) return { ok: false, detail: 'Invalid API key.' }

  // api_key_by_prefix is SECURITY DEFINER and callable as `anon` precisely
  // because authentication is the one moment when there is no user yet.
  let row: ApiKeyLookup | null
  try {
    row = await apiKeyByPrefix(anonDb(), parsed.prefix)
  } catch (cause) {
    console.error('[api] key lookup failed on %s', requestId, cause)
    return { ok: false, detail: 'Could not verify the API key.' }
  }

  if (!row) return { ok: false, detail: 'Invalid API key.' }

  if (!secretMatches(parsed.secret, row.secret_hash)) {
    return { ok: false, detail: 'Invalid API key.' }
  }

  // Only now, once the secret is proven, is it safe to explain *why* a valid
  // key is being refused — this information is useless to someone guessing.
  const validity = checkValidity(row)
  if (!validity.ok) {
    return {
      ok: false,
      detail:
        validity.reason === 'revoked'
          ? 'This API key has been revoked.'
          : 'This API key has expired.',
    }
  }

  const scopes = parseScopes(row.scopes ?? [])
  if (!scopes.length) {
    return { ok: false, detail: 'This API key has no usable scopes.' }
  }

  // Fire and forget: recording "this key was used" must never fail the request
  // it describes, and it is not worth a round trip of latency.
  void touchApiKey(anonDb(), row.id).catch(() => {})

  return {
    ok: true,
    ctx: {
      userId: row.owner_id,
      // Every statement runs as this key's owner, so RLS isolates the tenant
      // exactly as it does for a browser session.
      db: userDb(row.owner_id),
      via: 'api_key',
      scopes: new Set(scopes),
      apiKeyId: row.id,
      requestId,
    },
  }
}
