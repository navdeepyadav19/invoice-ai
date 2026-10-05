import { serializeCustomer } from '@/lib/api/serialize'
import { parseWire } from '@/lib/api/validate'
import type { AuthContext } from '@/lib/auth/context'
import * as clients from '@/lib/services/clients'
import { customerWireSchema, customerWireToClient } from '@/lib/validators'

/** Customer operations shared by REST and MCP. See lib/operations/invoices.ts. */

export async function listCustomers(
  ctx: AuthContext,
  input: { query?: string | null; cursor?: string | null; limit?: number; include_deleted?: boolean },
) {
  const page = await clients.list(ctx, {
    query: input.query ?? undefined,
    cursor: input.cursor ?? null,
    limit: input.limit,
    includeArchived: input.include_deleted === true,
  })

  return { data: page.data.map(serializeCustomer), next_cursor: page.next_cursor }
}

/** `cus_…` or UUID. */
export async function retrieveCustomer(ctx: AuthContext, id: string) {
  return { data: serializeCustomer(await clients.get(ctx, id)) }
}

export async function createCustomer(ctx: AuthContext, raw: unknown) {
  const client = await clients.create(ctx, customerWireToClient(parseWire(customerWireSchema, raw)))
  return { data: serializeCustomer(client) }
}
