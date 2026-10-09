import { addCors, corsPreflight } from '@/lib/http/cors'
import { handleRevoke } from '@/lib/oauth/handlers'
import { oauthDeps } from '@/lib/oauth/store'

/** POST /oauth/revoke. The rules live in lib/oauth/handlers.ts; this only wires in the real dependencies. */
export async function POST(request: Request): Promise<Response> {
  return addCors(await handleRevoke(request, oauthDeps()))
}

export const OPTIONS = corsPreflight
