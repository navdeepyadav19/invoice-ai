import { json, withApi } from '@/lib/api/handler'
import { retrieveBusiness } from '@/lib/operations/catalog'

/**
 * GET /api/v1/business
 *
 * Read-only in v1. Writing a business profile means country/currency
 * cross-checks and an onboarding wizard; a bare PATCH would let an integration
 * reach a state the UI cannot produce and the DB constraints then reject on the
 * *next* write, which is a confusing place to find out.
 */
export const GET = withApi({ scope: 'business:read' }, async (ctx) => {
  return json(await retrieveBusiness(ctx))
})
