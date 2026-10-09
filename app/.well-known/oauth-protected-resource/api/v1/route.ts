import { addCors, corsPreflight } from '@/lib/http/cors'
import { protectedResourceMetadata } from '@/lib/oauth/metadata'

/**
 * RFC 9728 protected resource metadata for the REST API (/api/v1).
 * For third-party apps that use OAuth instead of an API key.
 */
export function GET(): Response {
  return addCors(Response.json(protectedResourceMetadata('api'), { headers: { 'cache-control': 'public, max-age=300' } }))
}

export const OPTIONS = corsPreflight
