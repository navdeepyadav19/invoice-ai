import { json, readJson, withApi } from '@/lib/api/handler'
import { serializeClient } from '@/lib/api/serialize'
import * as clients from '@/lib/services/clients'
import type { ClientInput } from '@/lib/validators'

type Params = { id: string }

/** GET /api/v1/clients/{id} */
export const GET = withApi<Params>({ scope: 'clients:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeClient(await clients.get(ctx, id)) })
})

/**
 * PATCH /api/v1/clients/{id}
 *
 * Naturally idempotent — setting a field to a value reaches the same end state
 * however many times it runs — so it needs no Idempotency-Key.
 */
export const PATCH = withApi<Params>({ scope: 'clients:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const body = (await readJson(request)) as Partial<ClientInput>

  return json({ data: serializeClient(await clients.update(ctx, id, body)) })
})
