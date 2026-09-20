import { json, withApi } from '@/lib/api/handler'
import { serializeClient } from '@/lib/api/serialize'
import * as clients from '@/lib/services/clients'

type Params = { id: string }

/**
 * POST /api/v1/clients/{id}/archive
 *
 * Archive, not DELETE. Issued invoices reference clients and must keep naming
 * who they were billed to, so the row survives and only disappears from lists.
 *
 * Archiving an already-archived client succeeds rather than 409-ing: a retry
 * asking for a state the row is already in has got what it wanted.
 */
export const POST = withApi<Params>({ scope: 'clients:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeClient(await clients.archive(ctx, id)) })
})

/** DELETE undoes it, for symmetry with the archive verb. */
export const DELETE = withApi<Params>({ scope: 'clients:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeClient(await clients.unarchive(ctx, id)) })
})
