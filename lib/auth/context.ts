import type { SupabaseClient } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/queries'
import { forbidden, ServiceError } from '@/lib/services/errors'
import { ALL_SCOPES, type Scope } from '@/lib/auth/scopes'
import type { Database } from '@/lib/database.types'

/**
 * Who is asking, and how.
 *
 * Every service function takes one of these as its first argument. That is the
 * whole trick of the service layer: a function that *receives* its identity can
 * be called by a browser, an API key or an AI assistant, whereas a function that
 * reaches for `cookies()` can only ever be called by a browser.
 *
 * `supabase` is already authenticated as this user, so RLS is doing the tenant
 * isolation in all three cases. Services never filter by owner_id by hand.
 */

export type AuthVia = 'session' | 'api_key' | 'oauth'

export interface AuthContext {
  userId: string
  /** Authenticated AS this user. RLS applies. Never a service_role client. */
  supabase: SupabaseClient<Database>
  via: AuthVia
  scopes: ReadonlySet<Scope>
  /** Set when `via` is 'api_key'. Recorded on events for the audit trail. */
  apiKeyId?: string
  /** Set when `via` is 'oauth'. The third-party app acting for the user. */
  clientId?: string
  requestId: string
  /** True for anonymous/guest sessions. Credentials are refused for these. */
  isAnonymous: boolean
}

/**
 * Build a context from the browser session.
 *
 * Note what this does NOT do: redirect. `requireUser()` in lib/queries.ts calls
 * `redirect('/login')`, which is right for a page and useless for anything else
 * — an API caller needs a 401, and throwing a redirect from a service would take
 * the whole request with it. Server actions still call `requireUser()` first;
 * by the time this runs, being signed in is already established.
 */
export async function contextFromSession(requestId = newRequestId()): Promise<AuthContext> {
  const user = await getCurrentUser()
  if (!user) throw new ServiceError('forbidden', 'Not signed in.')

  return {
    userId: user.id,
    supabase: await createClient(),
    via: 'session',
    // A person at a keyboard is not a delegated credential; there is no third
    // party to restrict. Scopes narrow what someone acts with *on your behalf*.
    scopes: ALL_SCOPES,
    requestId,
    isAnonymous: Boolean(user.is_anonymous),
  }
}

/**
 * Enforce a scope.
 *
 * Called inside services, not only at the HTTP edge. The edge check is the one
 * that fires in practice; this is the one that still fires when a future caller
 * (an MCP tool, a cron job, a new transport) forgets to add one.
 */
export function requireScope(ctx: AuthContext, scope: Scope): void {
  if (!ctx.scopes.has(scope)) {
    throw forbidden(`This credential is missing the ${scope} scope.`)
  }
}

/**
 * Reject guests.
 *
 * Anonymous users are ordinary tenants everywhere else — they legitimately
 * create invoices and claim numbers. But `cleanup_stale_guests` deletes them
 * after 30 days, and a deleted owner with live API keys is a credential pointing
 * at nothing. Keys and OAuth grants require a real account.
 */
export function requireRealAccount(ctx: AuthContext): void {
  if (ctx.isAnonymous) {
    throw forbidden('Create an account before generating API credentials.')
  }
}

export function newRequestId(): string {
  return `req_${crypto.randomUUID().replace(/-/g, '')}`
}
