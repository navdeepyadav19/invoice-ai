import { SCOPES } from '@/lib/auth/scopes'
import { MCP_SCOPES } from '@/lib/mcp/scopes'
import { issuer, resourceFor } from '@/lib/oauth/config'

/**
 * The two discovery documents, which are how an MCP client signs in knowing
 * nothing but the server URL:
 *
 *   1. POST /mcp → 401 with WWW-Authenticate: resource_metadata="…"
 *   2. GET that  → protectedResourceMetadata(): "my authorization server is X"
 *   3. GET X/.well-known/oauth-authorization-server → authorizationServerMetadata():
 *      where to register, authorize, and fetch tokens, and which features exist
 *   4. register (or present a Client ID Metadata Document), then the usual
 *      authorization-code + PKCE flow
 */

const DOCS = 'https://docs.horizonpay.co'

/** RFC 9728. One per protected resource: the MCP server, and the REST API. */
export function protectedResourceMetadata(resource: 'mcp' | 'api') {
  return {
    resource: resourceFor(resource),
    authorization_servers: [issuer()],
    scopes_supported: resource === 'mcp' ? MCP_SCOPES : SCOPES,
    bearer_methods_supported: ['header'],
    resource_name: resource === 'mcp' ? 'Invoice-AI MCP server' : 'Invoice-AI API',
    resource_documentation: resource === 'mcp' ? `${DOCS}/mcp/overview` : `${DOCS}/introduction`,
  }
}

/** RFC 8414. */
export function authorizationServerMetadata() {
  const base = issuer()
  return {
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    revocation_endpoint_auth_methods_supported: ['none', 'client_secret_basic', 'client_secret_post'],
    scopes_supported: SCOPES,
    // Apps may identify themselves by a URL to their own metadata (the MCP
    // spec's preferred way) instead of registering first.
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
    service_documentation: `${DOCS}/mcp/authentication`,
  }
}
