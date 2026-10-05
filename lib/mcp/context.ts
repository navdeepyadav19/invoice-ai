import type { AuthInfo } from '@modelcontextprotocol/server'

import type { AuthContext, AuthVia } from '@/lib/auth/context'
import { parseScopes, type Scope } from '@/lib/auth/scopes'
import { userDb } from '@/lib/db'

/**
 * Carry our AuthContext through the MCP SDK.
 *
 * The SDK passes one `AuthInfo` from the HTTP layer to every tool handler. It
 * can't carry a database handle, so it carries the facts the context is built
 * from (in `extra`), and each tool call rebuilds the context — including a
 * fresh `userDb(userId)`, so RLS scopes every statement to this user exactly as
 * it does for a REST request.
 */

interface ContextFacts {
  userId: string
  via: AuthVia
  apiKeyId: string | null
  clientId: string | null
  grantId: string | null
  requestId: string
}

export function toAuthInfo(ctx: AuthContext, token: string, expiresAt?: number): AuthInfo {
  const facts: ContextFacts = {
    userId: ctx.userId,
    via: ctx.via,
    apiKeyId: ctx.apiKeyId ?? null,
    clientId: ctx.clientId ?? null,
    grantId: ctx.grantId ?? null,
    requestId: ctx.requestId,
  }

  return {
    token,
    // The SDK wants *some* client id; ours is the OAuth client when there is
    // one, otherwise the API key that is acting as the client.
    clientId: ctx.clientId ?? ctx.apiKeyId ?? ctx.userId,
    scopes: [...ctx.scopes],
    expiresAt,
    extra: { invoiceAi: facts },
  }
}

export function contextFromAuthInfo(auth: AuthInfo | undefined): AuthContext {
  const facts = auth?.extra?.invoiceAi as ContextFacts | undefined
  // Unreachable through the route (auth is required before any tool runs), but
  // a tool must never run against an unknown user.
  if (!auth || !facts?.userId) throw new Error('MCP tool called without an authenticated context.')

  return {
    userId: facts.userId,
    db: userDb(facts.userId),
    via: facts.via,
    scopes: new Set<Scope>(parseScopes(auth.scopes)),
    apiKeyId: facts.apiKeyId ?? undefined,
    clientId: facts.clientId ?? undefined,
    grantId: facts.grantId ?? undefined,
    requestId: facts.requestId,
  }
}
