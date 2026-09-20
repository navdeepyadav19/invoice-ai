import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env'
import { createTokenClient } from '@/lib/supabase/for-token'
import { checkValidity, parseApiKey, secretMatches } from '@/lib/auth/api-key'
import { mintUserToken } from '@/lib/auth/mint'
import { parseScopes } from '@/lib/auth/scopes'
import type { AuthContext } from '@/lib/auth/context'
import type { Database } from '@/lib/database.types'

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

  const anon = anonClient()

  const { data, error } = await anon.rpc('api_key_by_prefix', { p_prefix: parsed.prefix })

  if (error) {
    console.error('[api] key lookup failed on %s: %s', requestId, error.message)
    return { ok: false, detail: 'Could not verify the API key.' }
  }

  const row = Array.isArray(data) ? data[0] : data
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

  let accessToken: string
  try {
    accessToken = await mintUserToken({ userId: row.owner_id, apiKeyId: row.id })
  } catch (cause) {
    // A missing signing key is a deployment error, not a caller error. Say so
    // in the log; the caller gets a generic failure.
    console.error('[api] could not mint a token on %s', requestId, cause)
    return { ok: false, detail: 'API key authentication is not configured on this deployment.' }
  }

  // Fire and forget: recording "this key was used" must never fail the request
  // it describes, and it is not worth a round trip of latency.
  void anon.rpc('touch_api_key', { p_id: row.id }).then(
    () => undefined,
    () => undefined,
  )

  return {
    ok: true,
    ctx: {
      userId: row.owner_id,
      supabase: createTokenClient(accessToken),
      via: 'api_key',
      scopes: new Set(scopes),
      apiKeyId: row.id,
      requestId,
      // Guests can never hold a key: the settings page refuses to create one
      // for an anonymous user, so anything that authenticates here is real.
      isAnonymous: false,
    },
  }
}

/**
 * A client with no user attached.
 *
 * Used only to call `api_key_by_prefix`, which is SECURITY DEFINER precisely
 * because authentication is the one moment when there is no `auth.uid()` yet.
 * Everything after this point runs through the minted user token.
 */
function anonClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
