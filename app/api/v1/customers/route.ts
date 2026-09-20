import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeCustomer } from '@/lib/api/serialize'
import * as clients from '@/lib/services/clients'
import { customerWireSchema, customerWireToClient } from '@/lib/validators'

/** GET /api/v1/customers?query=&cursor=&limit=&include_deleted= */
export const GET = withApi({ scope: 'clients:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams

  const page = await clients.list(ctx, {
    query: params.get('query') ?? undefined,
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    includeArchived: params.get('include_deleted') === 'true',
  })

  return json({ data: page.data.map(serializeCustomer), next_cursor: page.next_cursor })
})

/**
 * POST /api/v1/customers
 *
 * Idempotency is `optional` rather than `required`: a duplicate customer is
 * untidy and fixable, unlike a duplicate invoice number. Callers that care can
 * still send a key.
 */
export const POST = withApi({ scope: 'clients:write', idempotent: 'optional' }, async (ctx, request) => {
  const raw = (await readJson(request)) as unknown
  const client = await clients.create(ctx, customerWireToClient(parseWire(customerWireSchema, raw)))

  return json({ data: serializeCustomer(client) }, { status: 201 })
})
