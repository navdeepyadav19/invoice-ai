import type { Scope } from '@/lib/auth/scopes'

/**
 * Which permissions an AI assistant may hold, and asks for by default.
 *
 * An assistant is the least predictable client this product has: it acts on
 * whatever text reaches it, including text inside an invoice note that someone
 * else wrote. So the defaults are about blast radius:
 *
 *   read       look things up                       granted by default
 *   drafts     create customers and draft invoices  granted by default — a
 *              draft has no number, sends nothing, and can be deleted
 *   lifecycle  finalize, email, mark paid, void     offered, never pre-ticked:
 *              each is one-way, and the server still asks for confirmation
 *
 * Two scopes are never available to an assistant at all: managing webhooks
 * (it could redirect every future event to an attacker) and editing the
 * product catalog.
 */

export const MCP_READ_SCOPES = ['business:read', 'clients:read', 'products:read', 'invoices:read'] as const satisfies readonly Scope[]

export const MCP_DRAFT_SCOPES = ['clients:write', 'invoices:write'] as const satisfies readonly Scope[]

export const MCP_LIFECYCLE_SCOPES = ['invoices:finalize', 'invoices:send', 'payments:write'] as const satisfies readonly Scope[]

/** Everything an assistant may be granted. Advertised in the 401 challenge and metadata. */
export const MCP_SCOPES: readonly Scope[] = [...MCP_READ_SCOPES, ...MCP_DRAFT_SCOPES, ...MCP_LIFECYCLE_SCOPES]

/** Pre-ticked on the consent screen. */
export const MCP_DEFAULT_SCOPES: readonly Scope[] = [...MCP_READ_SCOPES, ...MCP_DRAFT_SCOPES]
