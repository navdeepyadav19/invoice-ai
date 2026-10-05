import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

import { deriveKey } from '@/lib/auth/derive-key'

/**
 * Confirmation tokens: the server's half of "are you sure?".
 *
 * Finalizing, emailing, marking paid and voiding can't be undone. MCP clients
 * usually ask the user before running a tool marked destructive — but that's
 * the client's choice, and a model can talk itself into "the user clearly
 * meant yes". So these tools refuse to act on the first call. Instead:
 *
 *   1. Called without `confirmation_token`, the tool changes nothing and returns
 *      a preview (who, how much, which address) plus a token.
 *   2. The model shows the preview and asks the user.
 *   3. Called again with the token, the tool acts — but only if the token is
 *      genuine, unexpired, for this action, this invoice, this connection, and
 *      the invoice still looks exactly as it did in the preview.
 *
 * The token is `ct_<payload>.<signature>`: the payload says what was previewed,
 * the HMAC signature proves we issued it. No database row is needed.
 *
 * What it does NOT prove: that a human read the preview. It proves the model
 * was shown the real state before acting, and that nothing changed in between
 * — a line edited, a recipient swapped — which is the failure that matters.
 */

export type ConfirmableAction = 'finalize' | 'send' | 'pay' | 'void'

export interface ConfirmationClaims {
  action: ConfirmableAction
  /** Internal invoice UUID, so `in_…` and the UUID confirm the same thing. */
  invoiceId: string
  /** Fingerprint of everything the user agreed to. See stateHash. */
  stateHash: string
  /** The connection that asked: an API key, OAuth grant or user. */
  credential: string
  userId: string
}

const TTL_SECONDS = 10 * 60
const LABEL = 'mcp-confirmation/v1'

export function signConfirmation(claims: ConfirmationClaims, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + TTL_SECONDS
  const payload = base64url(
    JSON.stringify({ a: claims.action, i: claims.invoiceId, h: claims.stateHash, c: claims.credential, u: claims.userId, e: exp }),
  )
  return { token: `ct_${payload}.${sign(payload)}`, expiresAt: new Date(exp * 1000).toISOString() }
}

export type ConfirmationCheck = { ok: true } | { ok: false; reason: 'malformed' | 'expired' | 'mismatch' | 'changed' }

export function verifyConfirmation(token: string, expected: ConfirmationClaims, now = Date.now()): ConfirmationCheck {
  const match = /^ct_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token)
  if (!match) return { ok: false, reason: 'malformed' }

  const [, payload, signature] = match
  const good = Buffer.from(sign(payload))
  const given = Buffer.from(signature)
  if (good.length !== given.length || !timingSafeEqual(good, given)) return { ok: false, reason: 'malformed' }

  let claims: { a: string; i: string; h: string; c: string; u: string; e: number }
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed' }
  }

  if (claims.e * 1000 <= now) return { ok: false, reason: 'expired' }
  if (
    claims.a !== expected.action ||
    claims.i !== expected.invoiceId ||
    claims.c !== expected.credential ||
    claims.u !== expected.userId
  ) {
    return { ok: false, reason: 'mismatch' }
  }
  if (claims.h !== expected.stateHash) return { ok: false, reason: 'changed' }

  return { ok: true }
}

/**
 * A fingerprint of the invoice and the action's own arguments.
 *
 * `updated` changes on any edit, so it alone catches most changes; the totals,
 * customer and arguments (recipient, reason, payment date) are included so the
 * fingerprint says, in one value, "this is what the user agreed to".
 */
export function stateHash(invoice: Record<string, unknown>, args: Record<string, unknown>): string {
  const fields = {
    status: invoice.status,
    updated: invoice.updated,
    total: invoice.total,
    currency: invoice.currency,
    customer: invoice.customer,
    lines: (invoice.lines as { data?: unknown[] } | undefined)?.data?.length ?? null,
    args,
  }
  return createHash('sha256').update(stableJson(fields)).digest('base64url')
}

/** JSON with sorted keys, so the same object always hashes the same. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

function sign(payload: string): string {
  return createHmac('sha256', deriveKey(LABEL)).update(payload).digest('base64url')
}

function base64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64url')
}
