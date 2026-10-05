import { createMcpHandler } from 'mcp-handler'

import { corsPreflight, withCors } from '@/lib/http/cors'
import { withBearerAuth } from '@/lib/mcp/auth'
import { INSTRUCTIONS } from '@/lib/mcp/instructions'
import { registerTools, SERVER_INFO } from '@/lib/mcp/server'

/**
 * https://invoice.horizonpay.co/mcp — the Invoice-AI MCP server.
 *
 * Streamable HTTP, stateless: every request builds a fresh server, handles
 * one JSON-RPC message, and is done — which is what lets it run as an ordinary
 * serverless function with no session store.
 *
 * Layers, outside in:
 *   withCors        browser-based clients (MCP Inspector) can read responses
 *   withBearerAuth  credential → AuthContext, or a 401 that tells the client
 *                   where to sign in (lib/mcp/auth.ts)
 *   mcp-handler     the protocol: initialize, tools/list, tools/call
 *   tools           lib/mcp/tools → the same operations REST uses
 */
const mcp = createMcpHandler(registerTools, { serverInfo: SERVER_INFO, instructions: INSTRUCTIONS })
const handler = withCors(withBearerAuth(mcp))

export { handler as GET, handler as POST, handler as DELETE }
export const OPTIONS = corsPreflight

// Sending renders a PDF and calls the email provider; leave it room.
export const maxDuration = 60
