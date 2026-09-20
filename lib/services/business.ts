import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, notFound } from '@/lib/services/errors'
import type { BusinessRow } from '@/lib/database.types'

/**
 * The "From" side of an invoice.
 *
 * Read-only over the API in v1. Writing a business profile is an onboarding
 * flow with country/currency defaults attached; exposing a bare PATCH would
 * let an integration put the business into a state the wizard cannot produce.
 */

/**
 * A user has exactly one business in v1.
 *
 * Same "oldest row wins" rule as lib/queries.ts#getPrimaryBusiness, kept
 * deliberately identical so the API and the web UI can never disagree about
 * which business an invoice belongs to. The difference is only that this one
 * isn't wrapped in React's `cache()` — that is a per-render concern and means
 * nothing outside a Server Component.
 */
export async function getPrimary(ctx: AuthContext): Promise<BusinessRow> {
  requireScope(ctx, 'business:read')

  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('No business profile yet. Finish onboarding first.')

  return data as BusinessRow
}

/** Null instead of throwing, for callers that treat "not onboarded" as normal. */
export async function findPrimary(ctx: AuthContext): Promise<BusinessRow | null> {
  requireScope(ctx, 'business:read')

  const { data, error } = await ctx.supabase
    .from('businesses')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error) throw fromPostgres(error)
  return (data as BusinessRow | null) ?? null
}
