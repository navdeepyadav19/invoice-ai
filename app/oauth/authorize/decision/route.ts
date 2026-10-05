import { handleDecision } from '@/lib/oauth/handlers'
import { oauthDeps } from '@/lib/oauth/store'

/**
 * The consent form's target. A plain form POST answered with a 303, rather
 * than a server action, so the redirect back to the app works for any kind of
 * return address (https, a loopback port, a native app's own scheme) — and
 * so the whole flow can be exercised with curl.
 */
export async function POST(request: Request): Promise<Response> {
  return handleDecision(request, oauthDeps())
}
