import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeCustomer } from '@/lib/api/serialize'
import * as clients from '@/lib/services/clients'
import {
  customerWirePartialToClient,
  customerWireSchema,
  type CustomerWireInput,
} from '@/lib/validators'

type Params = { id: string }

/** GET /api/v1/customers/{id} — `cus_…` or UUID. */
export const GET = withApi<Params>({ scope: 'clients:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeCustomer(await clients.get(ctx, id)) })
})

/**
 * PATCH /api/v1/customers/{id}
 *
 * Naturally idempotent — setting a field to a value reaches the same end state
 * however many times it runs — so it needs no Idempotency-Key.
 */
export const PATCH = withApi<Params>({ scope: 'clients:write' }, async (ctx, request, route) => {
  const { id } = await route.params
  const body = parseWire(customerWireSchema.partial(), (await readJson(request)) as unknown) as Partial<CustomerWireInput>

  return json({ data: serializeCustomer(await clients.update(ctx, id, customerWirePartialToClient(body))) })
})

/**
 * DELETE /api/v1/customers/{id}
 *
 * Archives rather than deletes: issued invoices reference customers and must
 * keep naming who they were billed to. Like Stripe's `deleted: true`.
 */
export const DELETE = withApi<Params>({ scope: 'clients:write' }, async (ctx, _request, route) => {
  const { id } = await route.params
  return json({ data: serializeCustomer(await clients.archive(ctx, id)) })
})
