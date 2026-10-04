import { requireScope, type AuthContext } from '@/lib/auth/context'
import { invalidState, notFound, q, ServiceError } from '@/lib/services/errors'
import { clientSchema, type ClientInput } from '@/lib/validators'
import { afterPosition, clampLimit, parseCursor, toPage, type Page } from '@/lib/services/pagination'
import { isCustomerId, isUuid, nextCustomerId } from '@/lib/catalog/ids'
import type { ClientRow } from '@/lib/database.types'

/**
 * Clients — the "Bill To" side.
 *
 * Today a client row only ever appears as a side effect of saving an invoice.
 * That is fine for a form where you type the name into the builder, and useless
 * for an integration that wants to sync a customer list before invoicing any of
 * them. These are the missing operations.
 *
 * Note there is no `delete`. Issued invoices reference clients, and an invoice
 * has to keep naming who it was billed to for as long as it exists — so the
 * only removal is `archive`, which hides the row without breaking the link.
 */

export interface ListClientsOptions {
  query?: string
  cursor?: string | null
  limit?: number
  includeArchived?: boolean
}

export async function list(ctx: AuthContext, options: ListClientsOptions = {}): Promise<Page<ClientRow>> {
  requireScope(ctx, 'clients:read')

  const limit = clampLimit(options.limit)

  let query = ctx.db
    .selectFrom('clients')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    // One extra row tells us whether another page exists without a count query.
    .limit(limit + 1)

  if (!options.includeArchived) query = query.where('archived_at', 'is', null)

  if (options.query) {
    // Escape the LIKE wildcards so a client searching for "10%" doesn't
    // accidentally match everything.
    const term = options.query.replace(/[%_]/g, (m) => `\\${m}`)
    query = query.where('name', 'ilike', `%${term}%`)
  }

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())

  return toPage(data as ClientRow[], limit)
}

export async function get(ctx: AuthContext, id: string): Promise<ClientRow> {
  requireScope(ctx, 'clients:read')

  if (!isCustomerId(id) && !isUuid(id)) throw notFound('Client not found.')

  const data = await q(
    ctx.db
      .selectFrom('clients')
      .selectAll()
      .where(isCustomerId(id) ? 'public_id' : 'id', '=', id)
      .executeTakeFirst(),
  )

  // RLS returns nothing for another owner's row, so this is also the "not
  // yours" answer. Deliberately indistinguishable — see services/errors.ts.
  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

export async function create(ctx: AuthContext, input: ClientInput): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const data = await q(
    ctx.db
      .insertInto('clients')
      .values({ ...emptyToNull(parsed.data), owner_id: ctx.userId, public_id: nextCustomerId() })
      .returningAll()
      .executeTakeFirstOrThrow(),
  )

  return data as ClientRow
}

export async function update(
  ctx: AuthContext,
  id: string,
  input: Partial<ClientInput>,
): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  // Partial update: validate only what was sent, so a PATCH carrying one field
  // isn't rejected for omitting `name`.
  const parsed = clientSchema.partial().safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const existing = await get(ctx, id)

  const data = await q(
    ctx.db
      .updateTable('clients')
      .set(emptyToNull(parsed.data))
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

/**
 * Archive, not delete.
 *
 * Archiving twice is a no-op rather than an error: an integration retrying a
 * failed request should not get a 409 for reaching the state it asked for.
 */
export async function archive(ctx: AuthContext, id: string): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const existing = await get(ctx, id)
  if (existing.archived_at) return existing

  const data = await q(
    ctx.db
      .updateTable('clients')
      .set({ archived_at: new Date().toISOString() })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

export async function unarchive(ctx: AuthContext, id: string): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const existing = await get(ctx, id)

  const data = await q(
    ctx.db
      .updateTable('clients')
      .set({ archived_at: null })
      .where('id', '=', existing.id)
      .returningAll()
      .executeTakeFirst(),
  )

  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

/**
 * A stored row back into the shape the invoice draft input expects.
 * Used when re-saving a draft (add/remove item, PATCH) without losing data.
 */
export function rowToInput(row: ClientRow): ClientInput {
  return {
    name: row.name,
    tax_id: row.tax_id ?? undefined,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    address_line1: row.address_line1 ?? undefined,
    address_line2: row.address_line2 ?? undefined,
    city: row.city ?? undefined,
    region: row.region ?? undefined,
    postal_code: (row.postal_code ?? row.pincode ?? undefined) as string | undefined,
    country_code: (row.country_code ?? undefined) as string | undefined,
    country: row.country ?? undefined,
  }
}
/**
 * Find an existing client by name, or create one.
 *
 * This is what "invoice Acme $25,000" needs: the caller has a name, not an id.
 * Matching is case-insensitive and exact — a fuzzy match that silently billed
 * "Acme Ltd" when you meant "Acme Industries" would be worse than creating a
 * duplicate you can merge later.
 */
export async function findOrCreateByName(ctx: AuthContext, input: ClientInput): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const data = await q(
    ctx.db
      .selectFrom('clients')
      .selectAll()
      .where('name', 'ilike', parsed.data.name)
      .where('archived_at', 'is', null)
      .limit(1)
      .executeTakeFirst(),
  )

  if (data) return data as ClientRow

  return create(ctx, parsed.data)
}

// ---------------------------------------------------------------------------

function emptyToNull<T extends Record<string, unknown>>(value: T): T {
  // The zod schemas accept '' for optional fields because an HTML form submits
  // empty strings. A database column should hold null, not ''.
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, v === '' ? null : v]),
  ) as T
}

function validationError(error: { issues: { path: PropertyKey[]; message: string }[] }): ServiceError {
  return new ServiceError(
    'validation',
    'Some fields need attention.',
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
  )
}

export { invalidState }
