import { isScope, type Scope } from '@/lib/auth/scopes'
import type { ApiRequestRow } from '@/lib/database.types'

/**
 * How connected AI assistants are described to the person who owns the data.
 *
 * Pure functions, shared by the Settings → AI assistants list (a client
 * component) and the activity page (a server component). Nothing here touches
 * the database, so it is safe to import from either side and easy to test.
 */

/**
 * Two words per scope, for badges. The full sentence (SCOPE_DESCRIPTIONS) is
 * right for a consent screen, where someone is deciding; a list of connected
 * apps is scanned, and eleven sentences per row would bury the one that matters.
 */
export const SCOPE_SHORT_LABELS: Record<Scope, string> = {
  'business:read': 'Business profile',
  'clients:read': 'Read clients',
  'clients:write': 'Edit clients',
  'products:read': 'Read products',
  'products:write': 'Edit products',
  'invoices:read': 'Read invoices',
  'invoices:write': 'Draft invoices',
  'invoices:finalize': 'Finalize & void',
  'invoices:send': 'Email invoices',
  'payments:write': 'Mark paid',
  'webhooks:manage': 'Webhooks',
}

/** A stored grant can outlive a scope rename, so unknown values show as-is. */
export function scopeLabel(scope: string): string {
  return isScope(scope) ? SCOPE_SHORT_LABELS[scope] : scope
}

export type ClientOrigin = { verified: true; host: string } | { verified: false }

/**
 * Can we vouch for who this app is?
 *
 * A CIMD client's client_id IS an https URL we fetched its metadata from, so
 * the host is proven: only whoever controls that domain could have published
 * the document. A DCR client registered itself anonymously and chose its own
 * name — "Claude" is just a string it sent us — so it is shown as unverified
 * rather than trusted on its word.
 */
export function clientOrigin(client: { client_kind: string; client_id_text: string }): ClientOrigin {
  if (client.client_kind !== 'cimd') return { verified: false }

  try {
    const url = new URL(client.client_id_text)
    return url.protocol === 'https:' ? { verified: true, host: url.host } : { verified: false }
  } catch {
    return { verified: false }
  }
}

/**
 * "MCP list_invoices" reads better than "MCP mcp/list_invoices". The route
 * keeps its prefix in the table so REST and tool calls never collide; the
 * prefix only gets in the way on screen.
 */
export function requestLabel(row: Pick<ApiRequestRow, 'method' | 'route'>): string {
  if (row.method === 'MCP') return `MCP ${row.route.replace(/^mcp\//, '')}`
  return `${row.method} ${row.route}`
}

/**
 * Who made the request, in words the owner recognises: the key's name, the
 * connected app's name, or "This browser".
 *
 * For OAuth rows api_requests.client_id holds oauth_clients.id (the uuid), so
 * the caller passes a map built from the owner's grants — revoked ones
 * included, or last month's requests from a since-disconnected app would lose
 * their name.
 */
export function requestCaller(
  row: Pick<ApiRequestRow, 'via' | 'api_key_id' | 'client_id'>,
  keyNames: ReadonlyMap<string, string>,
  appNames: ReadonlyMap<string, string>,
): string {
  if (row.api_key_id) return keyNames.get(row.api_key_id) ?? 'Deleted key'
  if (row.via === 'oauth') return (row.client_id && appNames.get(row.client_id)) || 'Removed app'
  if (row.via === 'session') return 'This browser'
  return '—'
}
