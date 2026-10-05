import { json, readJson, withApi } from '@/lib/api/handler'
import { createCustomer, listCustomers } from '@/lib/operations/customers'

/** GET /api/v1/customers?query=&cursor=&limit=&include_deleted= */
export const GET = withApi({ scope: 'clients:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams

  return json(
    await listCustomers(ctx, {
      query: params.get('query'),
      cursor: params.get('cursor'),
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
      include_deleted: params.get('include_deleted') === 'true',
    }),
  )
})

/**
 * POST /api/v1/customers
 *
 * Idempotency is `optional` rather than `required`: a duplicate customer is
 * untidy and fixable, unlike a duplicate invoice number. Callers that care can
 * still send a key.
 */
export const POST = withApi({ scope: 'clients:write', idempotent: 'optional' }, async (ctx, request) => {
  return json(await createCustomer(ctx, await readJson(request)), { status: 201 })
})
