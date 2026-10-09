import { addCors, corsPreflight } from '@/lib/http/cors'
import { handleToken } from '@/lib/oauth/handlers'
import { oauthDeps } from '@/lib/oauth/store'

/** POST /oauth/token. The rules live in lib/oauth/handlers.ts; this only wires in the real dependencies. */
export async function POST(request: Request): Promise<Response> {
  return addCors(await handleToken(request, oauthDeps()))
}

export const OPTIONS = corsPreflight
