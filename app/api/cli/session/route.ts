import { authenticate } from '@/lib/api/authenticate'
import { noContent } from '@/lib/api/handler'
import { problem, rateLimited, unauthorized } from '@/lib/api/problem'
import { checkRateLimit, DEFAULT_RULES, rateLimitHeaders } from '@/lib/api/rate-limit'
import { newRequestId } from '@/lib/auth/context'

/**
 * DELETE /api/cli/session — `invoice-ai logout`.
 *
 * Authenticated with the API key itself (Authorization: Bearer inv_live_…) and
 * revokes exactly that key. No scope is required: any credential may retire
 * itself, and doing so can only ever reduce what it can do. withApi is not used
 * because it insists on a scope, and adding a "revoke self" scope would imply a
 * key could lack the right to be turned off.
 *
 * 204 on success; 401 problem+json when the key is missing, invalid, expired or
 * already revoked (so a second logout is a harmless 401).
 */
export async function DELETE(request: Request) {
  const supplied = request.headers.get('x-request-id')?.trim()
  const requestId = supplied && supplied.length <= 200 ? supplied : newRequestId()

  const auth = await authenticate(request, requestId)
  if (!auth.ok) return unauthorized(auth.detail, requestId)

  const ctx = auth.ctx
  const keyId = ctx.apiKeyId
  if (!keyId) return unauthorized('Only an API key can end a CLI session.', requestId)

  const rule = DEFAULT_RULES.request
  const limit = await checkRateLimit(keyId, 'request', rule)
  if (!limit.ok) {
    return rateLimited(
      `Rate limit of ${rule.limit} per ${rule.windowSeconds}s exceeded.`,
      requestId,
      limit.retryAfter,
    )
  }

  // Runs as the key's owner (minted token), so the `own api keys` RLS policy is
  // what permits this update — the same path as Settings → Revoke.
  const { error } = await ctx.supabase
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', keyId)
    .is('revoked_at', null)

  if (error) {
    console.error('[cli] revoke failed on %s: %s', requestId, error.message)
    return problem({
      status: 500,
      code: 'internal_error',
      title: 'Internal server error',
      detail: 'Could not revoke the key. Revoke it in Settings → API keys instead.',
      instance: requestId,
    })
  }

  return noContent({ ...rateLimitHeaders(limit), 'x-request-id': requestId })
}
