import { after } from 'next/server'

import { authenticate } from '@/lib/api/authenticate'
import {
  idempotencyKeyRequired,
  problemFromError,
  rateLimited,
  unauthorized,
} from '@/lib/api/problem'
import * as idempotency from '@/lib/api/idempotency'
import {
  checkRateLimit,
  DEFAULT_RULES,
  rateLimitHeaders,
  type RateLimitRule,
} from '@/lib/api/rate-limit'
import { newRequestId, requireScope, type AuthContext } from '@/lib/auth/context'
import type { Scope } from '@/lib/auth/scopes'

/**
 * The one pipeline every /api/v1 endpoint runs through.
 *
 * Every step is something that, left to individual route handlers, would
 * eventually be forgotten in exactly one of them — and that one is the endpoint
 * that leaks a tenant's data or burns a second invoice number.
 *
 *   1. request id    accept X-Request-Id or generate one; echo it everywhere
 *   2. authenticate  API key → verify → mint a 60s user JWT
 *   3. rate limit    per credential → 429 + Retry-After
 *   4. scope check   403 before the handler runs
 *   5. idempotency   claim the key → replay / 409 / 422
 *   6. handler       calls a service, which checks the scope again
 *   7. map errors    ServiceError → problem+json
 *   8. audit         one row, after the response is sent
 */

export interface ApiRouteContext<P = unknown> {
  params: Promise<P>
}

export type ApiHandler<P = unknown> = (
  ctx: AuthContext,
  request: Request,
  routeContext: ApiRouteContext<P>,
) => Promise<Response>

export interface WithApiOptions {
  /** Required to reach the handler at all. */
  scope: Scope
  /**
   * required — reject without an Idempotency-Key (428). For anything that
   *            spends an invoice number, sends an email, or takes a payment action.
   * optional — honour a key if sent. For creates, where a duplicate is
   *            annoying but not legally meaningful.
   * none    — reads, and updates that are naturally idempotent (PATCH/DELETE
   *            of a specific row reaches the same end state however many times
   *            it runs).
   */
  idempotent?: idempotency.IdempotencyMode
  /** Tighter bucket for expensive operations. Defaults to the request bucket. */
  rateLimit?: RateLimitRule
  rateLimitBucket?: string
}

export function withApi<P = unknown>(options: WithApiOptions, handler: ApiHandler<P>) {
  return async function route(request: Request, routeContext: ApiRouteContext<P>): Promise<Response> {
    // Echoing a caller-supplied id is what makes a failure traceable across
    // their logs and ours. Ours is the fallback, not the override.
    const requestId = readRequestId(request)
    const startedAt = Date.now()
    const url = new URL(request.url)

    const auth = await authenticate(request, requestId)
    if (!auth.ok) return unauthorized(auth.detail, requestId)

    const ctx = auth.ctx
    const credentialId = ctx.apiKeyId ?? ctx.clientId ?? ctx.userId

    // --- 3. rate limit ----------------------------------------------------
    const rule = options.rateLimit ?? DEFAULT_RULES.request
    const bucket = options.rateLimitBucket ?? 'request'
    const limit = await checkRateLimit(credentialId, bucket, rule)

    if (!limit.ok) {
      const response = rateLimited(
        `Rate limit of ${rule.limit} per ${rule.windowSeconds}s exceeded.`,
        requestId,
        limit.retryAfter,
      )
      after(() => audit(ctx, request, url, 429, Date.now() - startedAt, null))
      return mergeHeaders(response, rateLimitHeaders(limit))
    }

    const headers = { ...rateLimitHeaders(limit), 'x-request-id': requestId }
    const mode: idempotency.IdempotencyMode = options.idempotent ?? 'none'
    let claimedKey: string | null = null

    try {
      // --- 4. scope -------------------------------------------------------
      // Checked here so a 403 costs nothing, and again inside the service so a
      // future caller that skips this wrapper still cannot exceed its scopes.
      requireScope(ctx, options.scope)

      // --- 5. idempotency -------------------------------------------------
      if (mode !== 'none') {
        const key = idempotency.readKey(request)

        if (!key && mode === 'required') {
          after(() => audit(ctx, request, url, 428, Date.now() - startedAt, null))
          return mergeHeaders(idempotencyKeyRequired(requestId), headers)
        }

        if (key) {
          // The body has to be read here to hash it, and a Request body can only
          // be read once — so the handler is given a clone.
          const body = await request.clone().text()
          const hash = idempotency.requestHash(request.method, url.pathname, body)
          const claim = await idempotency.claim(ctx, key, request.method, url.pathname, hash)

          if (claim.replay) {
            after(() => audit(ctx, request, url, claim.replay!.status, Date.now() - startedAt, key))
            return json(claim.replay.body, {
              status: claim.replay.status,
              // The one header that tells a caller their retry was a no-op.
              // Without it, a client cannot distinguish "issued now" from
              // "issued the first time" — which matters when the response
              // carries an invoice number they are about to act on.
              headers: { ...headers, 'idempotent-replayed': 'true' },
            })
          }

          claimedKey = key
        }
      }

      // --- 6. handler -----------------------------------------------------
      const response = await handler(ctx, request, routeContext)

      if (claimedKey) {
        // Only successful responses are stored. Replaying a 500 would make a
        // transient failure permanent for 24 hours.
        if (response.status < 400) {
          const stored = await response.clone().json().catch(() => null)
          await idempotency.complete(ctx, claimedKey, response.status, stored)
        } else {
          await idempotency.release(ctx, claimedKey)
        }
      }

      after(() => audit(ctx, request, url, response.status, Date.now() - startedAt, claimedKey))

      return mergeHeaders(response, headers)
    } catch (cause) {
      // Leave the key free so the caller's retry can actually run.
      if (claimedKey) await idempotency.release(ctx, claimedKey)

      const response = problemFromError(cause, requestId)
      after(() => audit(ctx, request, url, response.status, Date.now() - startedAt, claimedKey))

      return mergeHeaders(response, headers)
    }
  }
}

/**
 * JSON body parsing that fails as a validation error, not a crash.
 *
 * `request.json()` throws a SyntaxError on malformed input, which would surface
 * as a 500 — telling an integrator our server is broken when their JSON is.
 */
export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) return {}

  try {
    return JSON.parse(text)
  } catch {
    const { ServiceError } = await import('@/lib/services/errors')
    throw new ServiceError('validation', 'Request body is not valid JSON.')
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
  })
}

export function noContent(headers: Record<string, string> = {}): Response {
  return new Response(null, { status: 204, headers })
}

// ---------------------------------------------------------------------------

function readRequestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim()
  // Bounded: this value is echoed into responses and written to the audit
  // table, so an unbounded header would be a cheap way to write junk.
  if (supplied && supplied.length <= 200) return supplied
  return newRequestId()
}

/** Headers on a Response are immutable, so adding to one means copying it. */
function mergeHeaders(response: Response, extra: Record<string, string>): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(extra)) headers.set(key, value)

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

/**
 * One audit row per request.
 *
 * Runs in `after()`, so it adds no latency and cannot fail the request it
 * records. "Which app issued this invoice?" has to have an answer, and
 * invoice_events can't give it for reads.
 */
async function audit(
  ctx: AuthContext,
  request: Request,
  url: URL,
  status: number,
  durationMs: number,
  idempotencyKey: string | null,
): Promise<void> {
  const { error } = await ctx.supabase.from('api_requests').insert({
    request_id: ctx.requestId,
    owner_id: ctx.userId,
    via: ctx.via,
    api_key_id: ctx.apiKeyId ?? null,
    client_id: ctx.clientId ?? null,
    method: request.method,
    route: url.pathname,
    status,
    duration_ms: durationMs,
    idempotency_key: idempotencyKey,
    ip_hash: await hashIp(request),
  })

  if (error) {
    console.error('[api] audit insert failed for %s: %s', ctx.requestId, error.message)
  }
}

/**
 * An IP is personal data, and we only ever need "was this the same caller?".
 * A salted hash answers that without storing the address itself.
 */
async function hashIp(request: Request): Promise<string | null> {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim()
  if (!ip) return null

  const salt = process.env.API_KEY_PEPPER ?? ''
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}
