import { json, readJson, withApi } from '@/lib/api/handler'
import { serializeClient } from '@/lib/api/serialize'
import * as clients from '@/lib/services/clients'
import type { ClientInput } from '@/lib/validators'

/** GET /api/v1/clients?query=&cursor=&limit=&include_archived= */
export const GET = withApi({ scope: 'clients:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams

  const page = await clients.list(ctx, {
    query: params.get('query') ?? undefined,
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    includeArchived: params.get('include_archived') === 'true',
  })

  return json({ data: page.data.map(serializeClient), next_cursor: page.next_cursor })
})

/**
 * POST /api/v1/clients
 *
 * Idempotency is `optional` rather than `required`: a duplicate client is
 * untidy and fixable, unlike a duplicate invoice number. Callers that care can
 * still send a key.
 */
export const POST = withApi({ scope: 'clients:write', idempotent: 'optional' }, async (ctx, request) => {
  const body = (await readJson(request)) as ClientInput
  const client = await clients.create(ctx, body)

  return json({ data: serializeClient(client) }, { status: 201 })
})
