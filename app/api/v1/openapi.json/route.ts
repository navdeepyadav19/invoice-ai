import { buildOpenApiDocument } from '@/lib/api/openapi'
import { siteUrl } from '@/lib/supabase/env'

/**
 * GET /api/v1/openapi.json
 *
 * Public on purpose — it is the contract, not the data. Requiring a key to read
 * the spec would mean an integrator cannot generate a client until after they
 * have signed up, and every SDK generator would need credentials baked in.
 *
 * Deliberately NOT wrapped in withApi: that pipeline authenticates, and this
 * route must not.
 */
export function GET(): Response {
  const document = buildOpenApiDocument(`${siteUrl()}/api/v1`)

  return new Response(JSON.stringify(document, null, 2), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The spec only changes on deploy, so it is safe to cache at the edge.
      'cache-control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
