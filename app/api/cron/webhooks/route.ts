import { createClient } from '@supabase/supabase-js'
import { timingSafeEqual } from 'node:crypto'

import { supabaseUrl } from '@/lib/supabase/env'
import { deliver, nextAttemptAt } from '@/lib/webhooks/deliver'
import type { Database, WebhookDeliveryRow, WebhookEndpointRow } from '@/lib/database.types'

export const maxDuration = 60

/**
 * The webhook delivery worker.
 *
 * Runs on a schedule (see vercel.json) and drains the outbox: claim whatever is
 * due, POST it, and either mark it succeeded or schedule the next retry from
 * the backoff ladder in lib/webhooks/deliver.ts.
 *
 * The schedule is DAILY because Vercel's Hobby plan allows only one cron run
 * per day — a tighter schedule is rejected at deploy time. On Pro, change it to
 * run every 5 minutes; until then a failed webhook can wait up to 24h for its retry,
 * which makes webhooks close to unusable for anything time-sensitive. (This
 * note lives here because vercel.json's schema rejects extra keys like
 * "comment" and fails the build.)
 *
 * ── Why this is the one place a service-role client is allowed ──────────────
 *
 * Everywhere else in this codebase, tenant data is reached through a user token
 * so RLS does the isolation. Here there is no user: the worker has to read
 * pending deliveries across ALL owners, which no user token can do and no RLS
 * policy should ever permit.
 *
 * The risk is contained by not letting this client touch tenant tables at all.
 * It calls exactly two SECURITY DEFINER functions — claim_due_webhook_deliveries
 * and finish_webhook_delivery — both revoked from anon and authenticated. There
 * is no `.from('invoices')` in this file and there should never be one.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthorised(request)) {
    return new Response('Unauthorized', { status: 401 })
  }

  const admin = adminClient()
  if (!admin) {
    return Response.json(
      { error: 'SUPABASE_SERVICE_ROLE_KEY is not configured; webhook delivery is disabled.' },
      { status: 503 },
    )
  }

  const { data, error } = await admin.rpc('claim_due_webhook_deliveries', { p_limit: 50 })

  if (error) {
    console.error('[webhooks] could not claim deliveries: %s', error.message)
    return Response.json({ error: error.message }, { status: 500 })
  }

  const deliveries = (data ?? []) as WebhookDeliveryRow[]
  if (!deliveries.length) return Response.json({ claimed: 0, succeeded: 0, dead: 0 })

  // Endpoints are fetched once rather than per delivery: a burst of events for
  // one subscriber is the normal case, not the exception.
  const endpointIds = [...new Set(deliveries.map((d) => d.endpoint_id))]
  const { data: endpointRows } = await admin
    .from('webhook_endpoints')
    .select('*')
    .in('id', endpointIds)

  const endpoints = new Map(
    ((endpointRows ?? []) as WebhookEndpointRow[]).map((row) => [row.id, row]),
  )

  let succeeded = 0
  let dead = 0

  // Sequential on purpose. Firing 50 concurrent requests at a handful of
  // subscribers is indistinguishable from a small DoS from their side.
  for (const delivery of deliveries) {
    const endpoint = endpoints.get(delivery.endpoint_id)

    if (!endpoint || endpoint.disabled_at || !endpoint.active) {
      await finish(admin, delivery.id, 'dead', null, 'Endpoint is disabled or gone.', null)
      dead += 1
      continue
    }

    const result = await deliver(endpoint.url, endpoint.secret, delivery.id, delivery.payload)

    if (result.ok) {
      await finish(admin, delivery.id, 'succeeded', result.status ?? 200, null, null)
      succeeded += 1
      continue
    }

    const next = nextAttemptAt(delivery.attempt)

    if (next) {
      await finish(admin, delivery.id, 'pending', result.status ?? null, result.error ?? null, next)
    } else {
      // Ladder exhausted — roughly 35 hours of trying.
      await finish(admin, delivery.id, 'dead', result.status ?? null, result.error ?? null, null)
      dead += 1
    }
  }

  return Response.json({ claimed: deliveries.length, succeeded, dead })
}

/** Vercel Cron issues GET. Same work either way. */
export const GET = POST

// ---------------------------------------------------------------------------

async function finish(
  admin: ReturnType<typeof createClient<Database>>,
  id: string,
  status: string,
  responseCode: number | null,
  error: string | null,
  nextAttempt: Date | null,
): Promise<void> {
  const { error: rpcError } = await admin.rpc('finish_webhook_delivery', {
    p_id: id,
    p_status: status,
    p_response_code: responseCode,
    p_error: error,
    p_next_attempt_at: nextAttempt?.toISOString() ?? null,
  })

  if (rpcError) {
    console.error('[webhooks] could not finish delivery %s: %s', id, rpcError.message)
  }
}

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
 *
 * Without this check the route is a public endpoint that drains the queue —
 * which an attacker could call in a loop to exhaust the retry ladder and get
 * every pending delivery marked dead.
 */
function isAuthorised(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false

  const presented = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? ''

  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(secret, 'utf8')
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}

function adminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null

  return createClient<Database>(supabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}
