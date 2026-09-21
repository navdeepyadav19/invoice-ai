import { requireScope, type AuthContext } from '@/lib/auth/context'
import { fromPostgres, invalidState, notFound, ServiceError } from '@/lib/services/errors'
import { clientSchema, type ClientInput } from '@/lib/validators'
import { decodeCursor, encodeCursor, type Page } from '@/lib/services/pagination'
import { isCustomerId, nextCustomerId } from '@/lib/catalog/ids'
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

  let q = ctx.supabase
    .from('clients')
    .select('*')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    // One extra row tells us whether another page exists without a count query.
    .limit(limit + 1)

  if (!options.includeArchived) q = q.is('archived_at', null)

  if (options.query) {
    // Escape the PostgREST pattern wildcards so a client searching for "10%"
    // doesn't accidentally match everything.
    const term = options.query.replace(/[%_]/g, (m) => `\\${m}`)
    q = q.ilike('name', `%${term}%`)
  }

  const after = decodeCursor(options.cursor)
  if (after) {
    q = q.or(
      `created_at.lt.${after.createdAt},and(created_at.eq.${after.createdAt},id.lt.${after.id})`,
    )
  }

  const { data, error } = await q
  if (error) throw fromPostgres(error)

  return toPage((data ?? []) as ClientRow[], limit)
}

export async function get(ctx: AuthContext, id: string): Promise<ClientRow> {
  requireScope(ctx, 'clients:read')

  const q = ctx.supabase.from('clients').select('*')
  const { data, error } = isCustomerId(id)
    ? await q.eq('public_id', id).maybeSingle()
    : await q.eq('id', id).maybeSingle()

  if (error) throw fromPostgres(error)
  // RLS returns nothing for another owner's row, so this is also the "not
  // yours" answer. Deliberately indistinguishable — see services/errors.ts.
  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

export async function create(ctx: AuthContext, input: ClientInput): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const parsed = clientSchema.safeParse(input)
  if (!parsed.success) throw validationError(parsed.error)

  const { data, error } = await ctx.supabase
    .from('clients')
    .insert({ ...emptyToNull(parsed.data), owner_id: ctx.userId, public_id: nextCustomerId() })
    .select('*')
    .single()

  if (error) throw fromPostgres(error)
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

  const { data, error } = await ctx.supabase
    .from('clients')
    .update(emptyToNull(parsed.data))
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
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

  const { data, error } = await ctx.supabase
    .from('clients')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (!data) throw notFound('Client not found.')

  return data as ClientRow
}

export async function unarchive(ctx: AuthContext, id: string): Promise<ClientRow> {
  requireScope(ctx, 'clients:write')

  const existing = await get(ctx, id)

  const { data, error } = await ctx.supabase
    .from('clients')
    .update({ archived_at: null })
    .eq('id', existing.id)
    .select('*')
    .maybeSingle()

  if (error) throw fromPostgres(error)
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

  const { data, error } = await ctx.supabase
    .from('clients')
    .select('*')
    .ilike('name', parsed.data.name)
    .is('archived_at', null)
    .limit(1)
    .maybeSingle()

  if (error) throw fromPostgres(error)
  if (data) return data as ClientRow

  return create(ctx, parsed.data)
}

// ---------------------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}

function toPage<T extends { created_at: string; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data.at(-1)

  return {
    data,
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}

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
