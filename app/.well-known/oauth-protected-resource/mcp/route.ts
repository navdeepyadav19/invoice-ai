import { addCors, corsPreflight } from '@/lib/http/cors'
import { protectedResourceMetadata } from '@/lib/oauth/metadata'

/**
 * RFC 9728 protected resource metadata for the MCP server (/mcp).
 * MCP clients find it from the 401 challenge on /mcp.
 */
export function GET(): Response {
  return addCors(Response.json(protectedResourceMetadata('mcp'), { headers: { 'cache-control': 'public, max-age=300' } }))
}

export const OPTIONS = corsPreflight
