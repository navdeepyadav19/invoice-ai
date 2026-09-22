import { handleTokenRequest } from '@/lib/cli-auth/handlers'
import { cliHandlerDeps } from '@/lib/cli-auth/store'

/**
 * POST /api/cli/token — the CLI polls this every `interval` seconds
 * (RFC 8628 §3.4–3.5). Body: { "device_code": "…" }
 *
 * 200 exactly once per login, carrying the only copy of the key:
 *   { api_key: "inv_live_…", key_id, scopes: [...], account: { email, business_name } }
 *
 * Otherwise 400 { error, error_description } where error is one of
 * authorization_pending | slow_down | access_denied | expired_token |
 * invalid_grant | invalid_request; 429 rate_limited; 500 server_error.
 */
export async function POST(request: Request) {
  return handleTokenRequest(request, cliHandlerDeps())
}
