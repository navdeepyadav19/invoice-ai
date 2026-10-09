import { addCors, corsPreflight } from '@/lib/http/cors'
import { authorizationServerMetadata } from '@/lib/oauth/metadata'

/** RFC 8414: where to register, authorize and get tokens. Public and cacheable. */
export function GET(): Response {
  return addCors(Response.json(authorizationServerMetadata(), { headers: { 'cache-control': 'public, max-age=300' } }))
}

export const OPTIONS = corsPreflight
