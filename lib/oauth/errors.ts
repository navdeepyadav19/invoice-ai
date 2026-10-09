/**
 * OAuth's error vocabulary (RFC 6749 §5.2, RFC 7591 §3.2.2, RFC 8707).
 *
 * Clients branch on `error`; `error_description` is for the human reading a
 * log. Every OAuth response is `Cache-Control: no-store` — tokens and errors
 * about tokens must never sit in a cache.
 */

export type OAuthErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'invalid_grant'
  | 'unauthorized_client'
  | 'unsupported_grant_type'
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_redirect_uri'
  | 'invalid_client_metadata'
  | 'access_denied'
  | 'server_error'
  | 'temporarily_unavailable'

const NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' }

export function oauthJson(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } })
}

export function oauthError(error: OAuthErrorCode, description: string, status = 400, headers: Record<string, string> = {}): Response {
  return oauthJson({ error, error_description: description }, status, headers)
}
