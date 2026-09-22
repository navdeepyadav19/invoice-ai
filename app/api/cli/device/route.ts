import { handleDeviceRequest } from '@/lib/cli-auth/handlers'
import { cliHandlerDeps } from '@/lib/cli-auth/store'

/**
 * POST /api/cli/device — step 1 of `invoice-ai login` (RFC 8628 §3.1–3.2).
 *
 * Unauthenticated by design; rate-limited per IP. Body (all optional):
 *   { "client_name": "navdeep-mbp", "client_os": "darwin arm64" }
 * 200:
 *   { device_code, user_code: "WXYZ-2345", verification_uri,
 *     verification_uri_complete, interval: 5, expires_in: 600 }
 * Errors: { error, error_description } — 400 invalid_request, 429 rate_limited,
 * 500 server_error.
 */
export async function POST(request: Request) {
  return handleDeviceRequest(request, cliHandlerDeps())
}
