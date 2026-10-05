import { after } from 'next/server'

import * as idempotency from '@/lib/api/idempotency'
import { statusForError } from '@/lib/api/problem'
import {
  checkRateLimit,
  DEFAULT_RULES,
  type RateLimitResult,
  type RateLimitRule,
} from '@/lib/api/rate-limit'
import { newRequestId, requireScope, type AuthContext } from '@/lib/auth/context'
import type { Scope } from '@/lib/auth/scopes'

/**
 * The rules every operation runs through, whichever door it came in by.
 *
 * Invoice-AI has one set of operations ("finalize this invoice") and several
 * ways to call them: the REST API (lib/api/handler.ts → withApi) and the MCP
 * server (lib/mcp/define-tool.ts). Both must enforce exactly the same things —
 * an assistant must not be able to do what an API key with the same scopes
 * cannot — so the enforcement lives here, once, and knows nothing about HTTP:
 *
 *   rate limit   per credential → 'rate_limited'
 *   scope        before any work → thrown 'forbidden'
 *   idempotency  claim the key → replay / conflict / mismatch
 *   run          the operation itself (a service call)
 *   audit        one api_requests row, after the response has gone
 *
 * Authentication happens before this (each door reads credentials its own way),
 * and turning an outcome into a reply happens after it (problem+json for REST,
 * a tool result for MCP).
 */

export interface OperationSpec {
  /** Required to run at all. */
  scope: Scope
  /** See WithApiOptions in lib/api/handler.ts for what each mode is for. */
  idempotent?: idempotency.IdempotencyMode
  /** Tighter bucket for expensive operations. Defaults to the request bucket. */
  rateLimit?: RateLimitRule
  rateLimitBucket?: string
}

/** What the pipeline needs to know about one call, independent of transport. */
export interface OperationCall {
  /** 'GET', 'POST', … for REST; 'MCP' for a tool call. */
  method: string
  /** The URL path for REST; `mcp/<tool>` for a tool call. Audited and hashed. */
  route: string
  startedAt: number
  idempotencyKey: string | null
  /** Read only when an idempotency key has to be checked against it. */
  body: () => Promise<string>
  clientIp: string | null
}

export type OperationOutcome<R> = { limit: RateLimitResult } & (
  | { kind: 'done'; result: R; status: number }
  | { kind: 'replayed'; status: number; body: unknown; key: string }
  | { kind: 'rate_limited'; rule: RateLimitRule }
  | { kind: 'idempotency_key_required' }
  | { kind: 'failed'; error: unknown }
)

/**
 * How a finished operation looks to the pipeline: its status (for the audit
 * row, and to decide whether it may be replayed) and, lazily, the body to store
 * for replays. Only read when an idempotency key was claimed and it succeeded.
 */
export interface OperationResult {
  status: number
  stored: () => Promise<unknown>
}

export async function runOperation<R>(
  ctx: AuthContext,
  spec: OperationSpec,
  call: OperationCall,
  run: () => Promise<R>,
  describe: (result: R) => OperationResult,
): Promise<OperationOutcome<R>> {
  // Audited after the reply is sent: no latency, and a failed insert can't fail
  // the call it records. The duration is measured then, so it includes the work.
  const audit = (status: number, key: string | null) =>
    after(() => recordAudit(ctx, call, status, Date.now() - call.startedAt, key))

  // --- rate limit ---------------------------------------------------------
  const rule = spec.rateLimit ?? DEFAULT_RULES.request
  const limit = await checkRateLimit(credentialId(ctx), spec.rateLimitBucket ?? 'request', rule)

  if (!limit.ok) {
    audit(429, null)
    return { kind: 'rate_limited', rule, limit }
  }

  const mode = spec.idempotent ?? 'none'
  let claimedKey: string | null = null

  try {
    // --- scope ------------------------------------------------------------
    // Checked here so refusing costs nothing, and again inside the service so
    // a future caller that skips this pipeline still cannot exceed its scopes.
    requireScope(ctx, spec.scope)

    // --- idempotency --------------------------------------------------------
    if (mode !== 'none') {
      const key = call.idempotencyKey

      if (!key && mode === 'required') {
        audit(428, null)
        return { kind: 'idempotency_key_required', limit }
      }

      if (key) {
        const hash = idempotency.requestHash(call.method, call.route, await call.body())
        const claim = await idempotency.claim(ctx, key, call.method, call.route, hash)

        if (claim.replay) {
          audit(claim.replay.status, key)
          return { kind: 'replayed', ...claim.replay, key, limit }
        }

        claimedKey = key
      }
    }

    // --- run ----------------------------------------------------------------
    const result = await run()
    const { status, stored } = describe(result)

    if (claimedKey) {
      // Only successes are stored. Replaying a failure would make a transient
      // error permanent for the 24 hours the key lives.
      if (status < 400) await idempotency.complete(ctx, claimedKey, status, await stored())
      else await idempotency.release(ctx, claimedKey)
    }

    audit(status, claimedKey)
    return { kind: 'done', result, status, limit }
  } catch (error) {
    // Leave the key free so the caller's retry can actually run.
    if (claimedKey) await idempotency.release(ctx, claimedKey)

    audit(statusForError(error), claimedKey)
    return { kind: 'failed', error, limit }
  }
}

/**
 * Whose budget a call spends.
 *
 * An API key is its own credential: two keys of one owner get two budgets. An
 * OAuth grant is one user's connection to one app — keyed on the grant, never
 * on the app's client id, which every user of that app shares. A browser
 * session falls back to the user.
 */
export function credentialId(ctx: AuthContext): string {
  if (ctx.apiKeyId) return ctx.apiKeyId
  if (ctx.grantId) return `oauth:${ctx.grantId}`
  return ctx.userId
}

/**
 * One audit row per call.
 *
 * "Which app issued this invoice?" has to have an answer, and invoice_events
 * can't give it for reads.
 */
export async function recordAudit(
  ctx: AuthContext,
  call: OperationCall,
  status: number,
  durationMs: number,
  idempotencyKey: string | null,
): Promise<void> {
  try {
    await ctx.db
      .insertInto('api_requests')
      .values({
        request_id: ctx.requestId,
        owner_id: ctx.userId,
        via: ctx.via,
        api_key_id: ctx.apiKeyId ?? null,
        client_id: ctx.clientId ?? null,
        method: call.method,
        route: call.route,
        status,
        duration_ms: durationMs,
        idempotency_key: idempotencyKey,
        ip_hash: await hashIp(call.clientIp),
      })
      .execute()
  } catch (error) {
    console.error('[api] audit insert failed for %s: %s', ctx.requestId, (error as Error).message)
  }
}

// ---------------------------------------------------------------------------
// Request helpers shared by the HTTP doors
// ---------------------------------------------------------------------------

export function readRequestId(request: Request): string {
  const supplied = request.headers.get('x-request-id')?.trim()
  // Bounded: this value is echoed into responses and written to the audit
  // table, so an unbounded header would be a cheap way to write junk.
  if (supplied && supplied.length <= 200) return supplied
  return newRequestId()
}

export function clientIp(request: Request): string | null {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}

/**
 * An IP is personal data, and we only ever need "was this the same caller?".
 * A salted hash answers that without storing the address itself.
 */
export async function hashIp(ip: string | null): Promise<string | null> {
  if (!ip) return null

  const salt = process.env.API_KEY_PEPPER ?? ''
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 32)
}
