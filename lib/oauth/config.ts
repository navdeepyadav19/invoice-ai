import { siteUrl } from '@/lib/env'
import { SCOPES, type Scope } from '@/lib/auth/scopes'
import { MCP_SCOPES } from '@/lib/mcp/scopes'

/**
 * The authorization server's fixed facts.
 *
 * The issuer is this site's own origin: Invoice-AI is both the authorization
 * server (it signs users in and asks for consent) and the resource server (it
 * serves /mcp and /api/v1). A token names which of the two resources it is for
 * — its audience — and is only accepted there.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

export type Audience = 'mcp' | 'api'

export function issuer(): string {
  return siteUrl()
}

export function resourceFor(audience: Audience): string {
  return audience === 'mcp' ? `${issuer()}/mcp` : `${issuer()}/api/v1`
}

/**
 * A `resource` parameter in the one canonical spelling we store and compare:
 * lowercase scheme and host, no trailing slash, no query or fragment. Null if
 * it isn't one of ours.
 */
export function audienceOf(resource: string): Audience | null {
  const normalised = normaliseResource(resource)
  if (normalised === resourceFor('mcp')) return 'mcp'
  if (normalised === resourceFor('api')) return 'api'
  return null
}

export function normaliseResource(resource: string): string | null {
  try {
    const url = new URL(resource)
    if (url.hash || url.search || url.username || url.password) return null
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return null
  }
}

/**
 * What a client may ask for, by audience. An assistant (MCP) never gets
 * webhook management or catalog editing; a REST integration may.
 */
export function scopesFor(audience: Audience): readonly Scope[] {
  return audience === 'mcp' ? MCP_SCOPES : SCOPES
}
