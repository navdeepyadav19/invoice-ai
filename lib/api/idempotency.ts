import { createHash } from 'node:crypto'

import { ServiceError } from '@/lib/services/errors'
import type { AuthContext } from '@/lib/auth/context'

/**
 * Make a retried write do the work once.
 *
 * The contract, which matches Stripe's and is what SDK authors expect:
 *
 *   | situation                          | response                          |
 *   |------------------------------------|-----------------------------------|
 *   | first time seen                    | run it, store the response        |
 *   | same key, same body, completed     | replay, + Idempotent-Replayed     |
 *   | same key, still running            | 409 — retry in a moment           |
 *   | same key, DIFFERENT body           | 422 idempotency_mismatch          |
 *
 * That last row is the one people get wrong. Replaying the first response for a
 * different body would silently return invoice A when the caller asked for B —
 * so a key reused across different requests (usually generated once outside a
 * loop) has to be an error, loudly, at the point of the bug.
 */

export type IdempotencyMode = 'required' | 'optional' | 'none'

export interface IdempotencyClaim {
  key: string
  /** Replay this instead of running the handler. */
  replay?: { status: number; body: unknown }
}

export function requestHash(method: string, path: string, body: string): string {
  return createHash('sha256').update(`${method}\n${path}\n${body}`).digest('hex')
}

/**
 * Claim the key, or find out what to do instead.
 *
 * The claim is a single INSERT ... ON CONFLICT inside `claim_idempotency_key`,
 * so two simultaneous retries cannot both win — which is the whole point. Doing
 * a SELECT-then-INSERT here in TypeScript would reintroduce the race this is
 * meant to close.
 */
export async function claim(
  ctx: AuthContext,
  key: string,
  method: string,
  path: string,
  hash: string,
): Promise<IdempotencyClaim> {
  const { data, error } = await ctx.supabase.rpc('claim_idempotency_key', {
    p_key: key,
    p_method: method,
    p_path: path,
    p_request_hash: hash,
  })

  if (error) {
    const { fromPostgres } = await import('@/lib/services/errors')
    throw fromPostgres(error)
  }

  const row = Array.isArray(data) ? data[0] : data
  const outcome = row?.outcome ?? 'claimed'

  switch (outcome) {
    case 'claimed':
      return { key }

    case 'replay':
      return {
        key,
        replay: { status: row?.response_status ?? 200, body: row?.response_body ?? null },
      }

    case 'in_progress':
      throw new ServiceError(
        'conflict',
        'A request with this Idempotency-Key is still in flight. Retry in a moment.',
      )

    case 'mismatch':
      throw new ServiceError(
        'idempotency_mismatch',
        'This Idempotency-Key was already used with a different request body.',
        [
          {
            path: 'Idempotency-Key',
            message: 'Generate a new key per distinct request, not per retry loop.',
          },
        ],
      )

    default:
      return { key }
  }
}

export async function complete(
  ctx: AuthContext,
  key: string,
  status: number,
  body: unknown,
): Promise<void> {
  const { error } = await ctx.supabase.rpc('complete_idempotency_key', {
    p_key: key,
    p_status: status,
    p_body: (body ?? null) as never,
  })

  // Failing to store the response means a retry re-runs the work rather than
  // replaying — degraded, not dangerous, and issue_invoice() still holds the
  // line on the one operation where re-running would actually cost something.
  if (error) {
    console.error('[idempotency] could not store response for %s: %s', key, error.message)
  }
}

/**
 * Release a key whose handler threw.
 *
 * Without this, a 500 leaves the key `in_progress` and every retry gets a 409
 * until the 24-hour expiry — the client is locked out of an operation that
 * never succeeded.
 */
export async function release(ctx: AuthContext, key: string): Promise<void> {
  const { error } = await ctx.supabase.rpc('release_idempotency_key', { p_key: key })

  if (error) {
    console.error('[idempotency] could not release %s: %s', key, error.message)
  }
}

export function readKey(request: Request): string | null {
  const value = request.headers.get('idempotency-key')?.trim()
  if (!value) return null
  // Bounded because it becomes a primary key column.
  if (value.length > 255) return null
  return value
}
