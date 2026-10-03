import { requireScope, type AuthContext } from '@/lib/auth/context'
import { notFound, q, ServiceError } from '@/lib/services/errors'
import { afterPosition, clampLimit, parseCursor, toPage, type Page } from '@/lib/services/pagination'
import { isUuid } from '@/lib/catalog/ids'
import { assertSafeUrl } from '@/lib/webhooks/deliver'
import { generateSecret } from '@/lib/webhooks/sign'
import { WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/events'

/**
 * Webhook endpoint management.
 *
 * The catalogue itself lives in lib/webhooks/events.ts so client components can
 * import it without dragging the server tree into the browser bundle.
 *
 * There is deliberately no `invoice.overdue`: overdue is computed from
 * `due_date` when an invoice is read (lib/invoice-status.ts), never stored, so
 * there is no moment at which it "becomes" overdue and nothing to fire from. An
 * integrator who wants that polls the list endpoint with `status=overdue`.
 */
export { WEBHOOK_EVENTS, type WebhookEvent } from '@/lib/webhooks/events'

export interface WebhookEndpointRow {
  id: string
  owner_id: string
  url: string
  secret: string
  events: string[]
  active: boolean
  failure_count: number
  disabled_at: string | null
  created_at: string
}

export async function list(
  ctx: AuthContext,
  options: { cursor?: string | null; limit?: number } = {},
): Promise<Page<WebhookEndpointRow>> {
  requireScope(ctx, 'webhooks:manage')

  const limit = clampLimit(options.limit)
  let query = ctx.db
    .selectFrom('webhook_endpoints')
    .selectAll()
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .limit(limit + 1)

  const after = parseCursor(options.cursor)
  if (after) query = query.where(afterPosition(after))

  const data = await q(query.execute())
  return toPage(data as WebhookEndpointRow[], limit)
}

export async function create(
  ctx: AuthContext,
  input: { url: string; events?: string[] },
): Promise<WebhookEndpointRow & { secret: string }> {
  requireScope(ctx, 'webhooks:manage')

  // Validated here as well as by the DB constraint, because this is where we
  // can explain *why* — and because the DNS/private-range check cannot be
  // expressed as a CHECK constraint at all.
  const guard = await assertSafeUrl(input.url)
  if (!guard.ok) {
    throw new ServiceError('validation', guard.reason, [{ path: 'url', message: guard.reason }])
  }

  const unknown = (input.events ?? []).filter(
    (event) => !WEBHOOK_EVENTS.includes(event as WebhookEvent),
  )
  if (unknown.length) {
    throw new ServiceError('validation', `Unknown event type: ${unknown.join(', ')}.`, [
      { path: 'events', message: `Valid types are ${WEBHOOK_EVENTS.join(', ')}.` },
    ])
  }

  const secret = generateSecret()

  const data = await q(
    ctx.db
      .insertInto('webhook_endpoints')
      .values({
        owner_id: ctx.userId,
        url: input.url,
        secret,
        // text[], so a JS array goes in as-is. Empty means "everything", so a
        // subscriber need not re-register each time we add an event type.
        events: input.events ?? [],
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  )

  // The only time the secret is returned. It stays in the database because we
  // need it to sign, but the API never echoes it again.
  return data as WebhookEndpointRow & { secret: string }
}

export async function remove(ctx: AuthContext, id: string): Promise<void> {
  requireScope(ctx, 'webhooks:manage')
  if (!isUuid(id)) throw notFound('Webhook endpoint not found.')

  const data = await q(
    ctx.db.deleteFrom('webhook_endpoints').where('id', '=', id).returning('id').executeTakeFirst(),
  )

  if (!data) throw notFound('Webhook endpoint not found.')
}

/**
 * Everything except the secret.
 *
 * Returning it on a list would mean it leaks into logs, browser history and
 * screenshots for every endpoint at once.
 */
export function serializeEndpoint(row: WebhookEndpointRow, includeSecret = false) {
  return {
    id: row.id,
    url: row.url,
    events: row.events.length ? row.events : WEBHOOK_EVENTS,
    active: row.active && !row.disabled_at,
    disabled_at: row.disabled_at,
    failure_count: row.failure_count,
    created_at: row.created_at,
    ...(includeSecret ? { secret: row.secret } : {}),
  }
}
