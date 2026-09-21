/**
 * Per-credential rate limiting.
 *
 * Two layers are intended, and they do different jobs:
 *
 *   Edge (Vercel WAF)  keyed by IP, stops floods before a function runs, so
 *                      blocked requests cost nothing. Cannot key on an API key
 *                      — header-based keys are an Enterprise feature — and its
 *                      counters are per-region.
 *   App (here)         keyed by credential, so one tenant's runaway script
 *                      cannot consume another tenant's budget.
 *
 * LIMITATION, deliberate and temporary: the default store below is per-instance
 * memory. On Vercel that means the limit is enforced per warm function instance,
 * not globally — a caller spread across 4 instances gets roughly 4x the budget.
 * That is still enough to stop a single runaway loop, which is the common case,
 * but it is NOT a billing control or a defence against a determined attacker.
 *
 * Swapping in a shared store is a one-function change: implement `RateLimitStore`
 * against a Marketplace Redis/KV and pass it to `configureRateLimit`.
 */

export interface RateLimitStore {
  /** Increment the counter for `key`, returning the new count and window end. */
  hit(key: string, windowSeconds: number): Promise<{ count: number; resetAt: number }>
}

export interface RateLimitRule {
  limit: number
  windowSeconds: number
}

/**
 * Sends are limited far more tightly than reads because each one costs money,
 * lands in someone's inbox, and is the thing an attacker with a stolen key
 * would abuse first.
 */
export const DEFAULT_RULES = {
  request: { limit: 120, windowSeconds: 60 },
  send: { limit: 10, windowSeconds: 3600 },
} satisfies Record<string, RateLimitRule>

export interface RateLimitResult {
  ok: boolean
  limit: number
  remaining: number
  /** Unix seconds when the window resets. */
  resetAt: number
  retryAfter: number
}

class MemoryStore implements RateLimitStore {
  private readonly counters = new Map<string, { count: number; resetAt: number }>()

  async hit(key: string, windowSeconds: number) {
    const now = Date.now()
    const existing = this.counters.get(key)

    if (!existing || existing.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowSeconds * 1000 }
      this.counters.set(key, fresh)
      this.sweep(now)
      return fresh
    }

    existing.count += 1
    return existing
  }

  /** Without this the map grows for every key ever seen — a slow leak. */
  private sweep(now: number): void {
    if (this.counters.size < 10_000) return
    for (const [key, value] of this.counters) {
      if (value.resetAt <= now) this.counters.delete(key)
    }
  }
}

let store: RateLimitStore = new MemoryStore()

export function configureRateLimit(next: RateLimitStore): void {
  store = next
}

export async function checkRateLimit(
  credentialId: string,
  bucket: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const { count, resetAt } = await store.hit(`${bucket}:${credentialId}`, rule.windowSeconds)
  const resetSeconds = Math.ceil(resetAt / 1000)

  return {
    ok: count <= rule.limit,
    limit: rule.limit,
    remaining: Math.max(rule.limit - count, 0),
    resetAt: resetSeconds,
    retryAfter: Math.max(resetSeconds - Math.floor(Date.now() / 1000), 1),
  }
}

/**
 * The IETF draft header names, which is what SDK authors and HTTP clients look
 * for. A client that can see its remaining budget can back off before being
 * refused, instead of discovering the limit by hitting a 429.
 */
export function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    'ratelimit-limit': String(result.limit),
    'ratelimit-remaining': String(result.remaining),
    'ratelimit-reset': String(result.resetAt),
  }
}
