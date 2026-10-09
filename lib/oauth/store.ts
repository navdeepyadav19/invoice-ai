import 'server-only'

import { clientIp } from '@/lib/api/pipeline'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { anonDb, userDb } from '@/lib/db'
import {
  oauthAuthorize,
  oauthCacheCimdClient,
  oauthClientLookup,
  oauthRedeemCode,
  oauthRegisterClient,
  oauthRevokeToken,
  oauthRotateRefresh,
} from '@/lib/db/rpc'
import { safeGetJson } from '@/lib/net/safe-fetch'
import { siteUrl } from '@/lib/env'
import { getCurrentUser } from '@/lib/queries'
import type { OAuthDeps, OAuthStore } from '@/lib/oauth/handlers'

/**
 * The real dependencies behind lib/oauth/handlers.ts.
 *
 * Every unauthenticated step (registering, redeeming a code, refreshing,
 * revoking) runs as `anon` through SECURITY DEFINER functions — the same
 * shape as API-key lookup and the CLI device flow. Approving consent is the
 * one step that runs as the signed-in user, so the grant it creates is
 * provably theirs.
 */
export const oauthStore: OAuthStore = {
  async lookupClient(clientId) {
    const row = await oauthClientLookup(anonDb(), clientId)
    if (!row) return null
    return {
      id: row.id,
      clientId: row.client_id,
      kind: row.kind,
      name: row.client_name,
      clientUri: row.client_uri,
      redirectUris: row.redirect_uris,
      grantTypes: row.grant_types,
      authMethod: row.token_endpoint_auth_method,
      secretHash: row.client_secret_hash,
      expiresAt: row.metadata_expires_at,
    }
  },
  async cacheCimdClient(input) {
    await oauthCacheCimdClient(anonDb(), { ...input, logoUri: null })
  },
  registerClient: (input) => oauthRegisterClient(anonDb(), input),
  async authorize(userId, input) {
    await oauthAuthorize(userDb(userId), input)
  },
  redeemCode: (input) => oauthRedeemCode(anonDb(), input),
  rotateRefresh: (input) => oauthRotateRefresh(anonDb(), input),
  revokeToken: (hash, clientUuid) => oauthRevokeToken(anonDb(), hash, clientUuid),
}

export function oauthDeps(): OAuthDeps {
  return {
    store: oauthStore,
    rateLimit: (key, limit, windowSeconds) => checkRateLimit(key, 'oauth', { limit, windowSeconds }),
    fetchMetadata: (url) => safeGetJson(url, { maxBytes: 8192, timeoutMs: 5000 }),
    async currentUser() {
      const user = await getCurrentUser()
      return user ? { id: user.id } : null
    },
    ready: () => Boolean(process.env.API_KEY_PEPPER),
    siteOrigin: siteUrl(),
    now: () => Date.now(),
    clientIp,
  }
}
