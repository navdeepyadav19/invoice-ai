import { anonDb, userDb } from '@/lib/db'
import { apiKeyByPrefix, touchApiKey, type ApiKeyLookup } from '@/lib/db/rpc'
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
  | { ok: true; ctx: AuthContext }
  | { ok: false; detail: string }

export async function authenticate(request: Request, requestId: string): Promise<AuthResult> {
  const header = request.headers.get('authorization')

  if (!header) {
    return { ok: false, detail: 'Send your API key as `Authorization: Bearer inv_live_…`.' }
  }

  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) {
    return { ok: false, detail: 'Authorization header must use the Bearer scheme.' }
  }

  const token = match[1].trim()

  // OAuth access tokens (phase A4) will also arrive here and are distinguished
  // by *not* carrying our key prefix. Until then, anything else is a 401.
  if (!token.startsWith('inv_live_')) {
    return { ok: false, detail: 'Unrecognised credential. Expected an Invoice-AI API key.' }
  }

  return authenticateApiKey(token, requestId)
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
