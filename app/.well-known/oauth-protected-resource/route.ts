import { addCors, corsPreflight } from '@/lib/http/cors'
import { protectedResourceMetadata } from '@/lib/oauth/metadata'

/**
 * RFC 9728 protected resource metadata for the MCP server (/mcp).
 * The root location, for clients that look here before the path-suffixed one.
 */
export function GET(): Response {
  return addCors(Response.json(protectedResourceMetadata('mcp'), { headers: { 'cache-control': 'public, max-age=300' } }))
}

export const OPTIONS = corsPreflight
