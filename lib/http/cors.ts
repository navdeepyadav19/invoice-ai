/**
 * CORS for the endpoints machines call from browsers: the MCP endpoint, the
 * OAuth token/registration endpoints and the discovery documents.
 *
 * `Access-Control-Allow-Origin: *` is safe here, and only here, because none of
 * these endpoints read cookies. A browser page on another origin can call them,
 * but only with a bearer token or client credentials it already holds — so CORS
 * grants it nothing it couldn't do from a server. The consent page and every
 * cookie-authenticated route get no CORS headers at all.
 */

const HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
  'access-control-allow-headers':
    'Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  // Without this a browser client can't read the 401 challenge that tells it
  // where to start the OAuth flow.
  'access-control-expose-headers': 'WWW-Authenticate, Mcp-Session-Id, Mcp-Protocol-Version',
  'access-control-max-age': '86400',
}

export function withCors(handler: (request: Request) => Promise<Response>) {
  return async (request: Request): Promise<Response> => addCors(await handler(request))
}

export function addCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** The answer to a browser's preflight `OPTIONS` request. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: HEADERS })
}
