import { json, withApi } from '@/lib/api/handler'
import { serializeBusiness } from '@/lib/api/serialize'
import * as businesses from '@/lib/services/business'

/**
 * GET /api/v1/business
 *
 * Read-only in v1. Writing a business profile means GSTIN lookup, state-code
 * cross-checks and an onboarding wizard; a bare PATCH would let an integration
 * reach a state the UI cannot produce and the DB constraints then reject on the
 * *next* write, which is a confusing place to find out.
 */
export const GET = withApi({ scope: 'business:read' }, async (ctx) => {
  const business = await businesses.getPrimary(ctx)
  return json({ data: serializeBusiness(business) })
})
