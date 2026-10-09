import { addCors, corsPreflight } from '@/lib/http/cors'
import { handleRegister } from '@/lib/oauth/handlers'
import { oauthDeps } from '@/lib/oauth/store'

/** POST /oauth/register. The rules live in lib/oauth/handlers.ts; this only wires in the real dependencies. */
export async function POST(request: Request): Promise<Response> {
  return addCors(await handleRegister(request, oauthDeps()))
}

export const OPTIONS = corsPreflight
