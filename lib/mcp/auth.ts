import type { AuthInfo } from '@modelcontextprotocol/server'
// Brings in mcp-handler's `Request.auth` declaration, which is how it hands auth to the SDK.
import type {} from 'mcp-handler'

import { authenticateBearer } from '@/lib/api/authenticate'
import { readRequestId } from '@/lib/api/pipeline'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { siteUrl } from '@/lib/env'
import { toAuthInfo } from '@/lib/mcp/context'
import { MCP_SCOPES } from '@/lib/mcp/scopes'

/**
 * Authentication for the MCP endpoint.
 *
 * Every request must carry a bearer credential: an OAuth access token issued
 * for this server, or an API key. Without one the answer is the 401 the MCP
 * spec requires (and RFC 9728 defines):
 *
 *   WWW-Authenticate: Bearer error="invalid_token",
 *                     resource_metadata="https://…/.well-known/oauth-protected-resource/mcp",
 *                     scope="business:read clients:read …"
 *
 * That header is how Claude, ChatGPT or any MCP client discovers *where* to
 * sign in: it fetches resource_metadata, finds our authorization server, and
 * starts OAuth. No configuration on the user's side beyond the URL.
 *
 * Scopes are not enforced here — each tool checks its own (a read-only
 * connection can still use the read tools). `scope=` only tells the client
 * which scopes to ask for.
 */

/** Requests per minute per credential, before any tool runs (initialize, tools/list…). */
const TRANSPORT_LIMIT = { limit: 300, windowSeconds: 60 }

export function mcpResourceUrl(): string {
  return `${siteUrl()}/mcp`
}

export function resourceMetadataUrl(): string {
  return `${siteUrl()}/.well-known/oauth-protected-resource/mcp`
}

export function withBearerAuth(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const header = request.headers.get('authorization') ?? ''
    const match = /^Bearer\s+(.+)$/i.exec(header.trim())
    if (!match) return challenge('No credential provided.')

    const verified = await verifyMcpToken(request, match[1].trim())
    if (!verified.ok) {
      // Too many requests is not a bad credential: answering 401 here would
      // make a client throw its token away and send the user to sign in again.
      if ('retryAfter' in verified) {
        return Response.json(
          { error: 'rate_limited', error_description: verified.detail },
          { status: 429, headers: { 'retry-after': String(verified.retryAfter) } },
        )
      }
      return challenge(verified.detail)
    }

    // mcp-handler passes `request.auth` to the SDK, which hands it to every
    // tool as `ctx.http.authInfo`.
    request.auth = verified.auth
    return handler(request)
  }
}

export async function verifyMcpToken(
  request: Request,
  token: string,
): Promise<{ ok: true; auth: AuthInfo } | { ok: false; detail: string; retryAfter?: number }> {
  const result = await authenticateBearer(token, readRequestId(request), { audience: 'mcp' })
  if (!result.ok) return result

  const { ctx } = result
  const credential = ctx.apiKeyId ?? (ctx.grantId ? `oauth:${ctx.grantId}` : ctx.userId)
  const limit = await checkRateLimit(credential, 'mcp-transport', TRANSPORT_LIMIT)
  if (!limit.ok) return { ok: false, detail: `Too many requests. Retry in ${limit.retryAfter}s.`, retryAfter: limit.retryAfter }

  return { ok: true, auth: toAuthInfo(ctx, token, result.expiresAt) }
}

function challenge(description: string): Response {
  const params = [
    'error="invalid_token"',
    `error_description="${description.replaceAll('"', "'")}"`,
    `resource_metadata="${resourceMetadataUrl()}"`,
    `scope="${MCP_SCOPES.join(' ')}"`,
  ]

  return Response.json(
    { error: 'invalid_token', error_description: description },
    { status: 401, headers: { 'www-authenticate': `Bearer ${params.join(', ')}` } },
  )
}
