import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * Standard Webhooks signatures (standardwebhooks.com).
 *
 * Three headers travel with every delivery:
 *
 *   webhook-id:        msg_2Kf…                    unique per delivery
 *   webhook-timestamp: 1789371234                  unix seconds
 *   webhook-signature: v1,<base64 HMAC-SHA256>     over "{id}.{timestamp}.{body}"
 *
 * Why the id and timestamp are inside the signed string rather than alongside
 * it: signing only the body means a captured request can be replayed forever,
 * and its signature still verifies. Binding the timestamp lets a receiver
 * reject anything older than a few minutes, and binding the id lets them
 * deduplicate without trusting an unsigned header.
 *
 * `v1,` is a version prefix so the scheme can change without every receiver
 * breaking on the same day. Multiple space-separated signatures are allowed,
 * which is how a secret is rotated: sign with both for a window.
 *
 * NOTE on storage: unlike an API key, this secret cannot be hashed — we need it
 * to produce a signature, so it must be recoverable. It is stored in the clear
 * in webhook_endpoints.secret today. Moving it behind Supabase Vault or app-level
 * encryption is tracked as an open item.
 */

const SIGNATURE_VERSION = 'v1'

/** Five minutes, matching the Standard Webhooks recommendation. */
export const REPLAY_TOLERANCE_SECONDS = 300

export function generateSecret(): string {
  // whsec_ prefix for the same reason API keys carry one: it is recognisable in
  // a log or a secret scan.
  return `whsec_${randomBytes(24).toString('base64url')}`
}

export function sign(secret: string, id: string, timestamp: number, body: string): string {
  const signed = `${id}.${timestamp}.${body}`
  const mac = createHmac('sha256', secretBytes(secret)).update(signed).digest('base64')

  return `${SIGNATURE_VERSION},${mac}`
}

export function signatureHeaders(
  secret: string,
  id: string,
  body: string,
  now = Date.now(),
): Record<string, string> {
  const timestamp = Math.floor(now / 1000)

  return {
    'webhook-id': id,
    'webhook-timestamp': String(timestamp),
    'webhook-signature': sign(secret, id, timestamp, body),
    'content-type': 'application/json; charset=utf-8',
    'user-agent': 'Invoice-AI-Webhooks/1.0',
  }
}

export interface VerifyInput {
  secret: string
  id: string
  timestamp: string | number
  signature: string
  body: string
  now?: number
}

/**
 * The receiver's half.
 *
 * Shipped so integrators don't hand-roll it — the two mistakes people make are
 * comparing signatures with `===` (timing leak) and skipping the timestamp
 * check entirely (replayable forever).
 */
export function verify(input: VerifyInput): { ok: boolean; reason?: string } {
  const timestamp = Number(input.timestamp)
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'bad_timestamp' }

  const now = Math.floor((input.now ?? Date.now()) / 1000)
  // Symmetric: a timestamp far in the FUTURE is as suspicious as an old one,
  // and usually means a clock problem rather than an attack.
  if (Math.abs(now - timestamp) > REPLAY_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' }
  }

  const expected = sign(input.secret, input.id, timestamp, input.body)

  // The header may carry several space-separated signatures during a rotation.
  const presented = input.signature.split(' ').filter(Boolean)
  const matched = presented.some((candidate) => constantTimeEquals(candidate, expected))

  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' }
}

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8')
  const right = Buffer.from(b, 'utf8')
  // timingSafeEqual throws on a length mismatch, and the length of a signature
  // is not secret, so checking it first is safe.
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Standard Webhooks specifies the secret is base64 after the `whsec_` prefix.
 * Accepting a raw string too means a hand-made secret still works instead of
 * failing with a confusing signature mismatch.
 */
function secretBytes(secret: string): Buffer {
  if (secret.startsWith('whsec_')) {
    return Buffer.from(secret.slice('whsec_'.length), 'base64url')
  }
  return Buffer.from(secret, 'utf8')
}
