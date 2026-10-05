import { authenticate } from '@/lib/api/authenticate'
import {
  idempotencyKeyRequired,
  problemFromError,
  rateLimited,
  unauthorized,
} from '@/lib/api/problem'
import * as idempotency from '@/lib/api/idempotency'
import { clientIp, readRequestId, runOperation } from '@/lib/api/pipeline'
import { rateLimitHeaders, type RateLimitRule } from '@/lib/api/rate-limit'
import type { AuthContext } from '@/lib/auth/context'
import type { Scope } from '@/lib/auth/scopes'

/**
 * The one pipeline every /api/v1 endpoint runs through.
 *
 * Every step is something that, left to individual route handlers, would
 * eventually be forgotten in exactly one of them — and that one is the endpoint
 * that leaks a tenant's data or burns a second invoice number.
 *
 *   1. request id    accept X-Request-Id or generate one; echo it everywhere
 *   2. authenticate  API key → verify → a db handle scoped to its owner
 *   3. rate limit    per credential → 429 + Retry-After
 *   4. scope check   403 before the handler runs
 *   5. idempotency   claim the key → replay / 409 / 422
 *   6. handler       calls a service, which checks the scope again
 *   7. map errors    ServiceError → problem+json
 *   8. audit         one row, after the response is sent
 *
 * Steps 3–6 and 8 live in runOperation (lib/api/pipeline.ts), shared with the
 * MCP server, so a tool call is held to exactly the rules an API request is.
 * This file is the HTTP half: reading the request, and turning each outcome
 * into a Response.
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

    const auth = await authenticate(request, requestId)
    if (!auth.ok) return unauthorized(auth.detail, requestId)

    const ctx = auth.ctx
    const outcome = await runOperation(
      ctx,
      options,
      {
        method: request.method,
        route: new URL(request.url).pathname,
        startedAt,
        idempotencyKey: idempotency.readKey(request),
        // The body has to be read to hash it, and a Request body can only be
        // read once — so the hash reads a clone and the handler the original.
        body: () => request.clone().text(),
        clientIp: clientIp(request),
      },
      () => handler(ctx, request, routeContext),
      (response) => ({
        status: response.status,
        stored: () => response.clone().json().catch(() => null),
      }),
    )

    const headers = { ...rateLimitHeaders(outcome.limit), 'x-request-id': requestId }

    switch (outcome.kind) {
      case 'rate_limited':
        return mergeHeaders(
          rateLimited(
            `Rate limit of ${outcome.rule.limit} per ${outcome.rule.windowSeconds}s exceeded.`,
            requestId,
            outcome.limit.retryAfter,
          ),
          rateLimitHeaders(outcome.limit),
        )

      case 'idempotency_key_required':
        return mergeHeaders(idempotencyKeyRequired(requestId), headers)

      case 'replayed':
        return json(outcome.body, {
          status: outcome.status,
          // The one header that tells a caller their retry was a no-op.
          // Without it, a client cannot distinguish "issued now" from "issued
          // the first time" — which matters when the response carries an
          // invoice number they are about to act on.
          headers: { ...headers, 'idempotent-replayed': 'true' },
        })

      case 'done':
        return mergeHeaders(outcome.result, headers)

      case 'failed':
        return mergeHeaders(problemFromError(outcome.error, requestId), headers)
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
