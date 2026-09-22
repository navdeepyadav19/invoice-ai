import { createHash, randomBytes } from 'node:crypto'

/**
 * Pure pieces of the CLI device flow (RFC 8628). No database, no Next — so they
 * can be unit-tested and reasoned about on their own. The flow itself is
 * described in supabase/migrations/0013_cli_device_auth.sql.
 */

/** Seconds the CLI waits between polls. Returned as `interval`. */
export const POLL_INTERVAL_SECONDS = 5
/** Matches the column default in 0013. Returned as `expires_in`. */
export const DEVICE_CODE_TTL_SECONDS = 600

// ---------------------------------------------------------------------------
// User code — what the human reads off the terminal and types into a browser
// ---------------------------------------------------------------------------

/**
 * No vowels or Y (so no accidental words, and no O/0 or I/1 confusion) and no
 * 0 or 1. The same alphabet GitHub uses for its device codes. 28 symbols, 8 characters:
 * 28^8 ≈ 3.8e11, far beyond what can be guessed in a 10-minute window behind a
 * rate limit.
 */
export const USER_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ23456789'
export const USER_CODE_LENGTH = 8

const USER_CODE_RE = new RegExp(`^[${USER_CODE_ALPHABET}]{${USER_CODE_LENGTH}}$`)

/** A fresh user code in stored (normalised, dash-free) form: `WXYZ2345`. */
export function generateUserCode(): string {
  const out: string[] = []
  const n = USER_CODE_ALPHABET.length
  // Rejection sampling: 256 is not a multiple of 28, so a plain `% 28` would
  // favour the first few symbols. Bytes >= 252 (9 * 28) are discarded.
  const limit = Math.floor(256 / n) * n
  while (out.length < USER_CODE_LENGTH) {
    for (const byte of randomBytes(USER_CODE_LENGTH * 2)) {
      if (byte >= limit) continue
      out.push(USER_CODE_ALPHABET[byte % n])
      if (out.length === USER_CODE_LENGTH) break
    }
  }
  return out.join('')
}

/** `WXYZ2345` → `WXYZ-2345`. Presentation only; the dash is never stored. */
export function formatUserCode(code: string): string {
  const normalised = normaliseUserCode(code) ?? code
  return `${normalised.slice(0, 4)}-${normalised.slice(4)}`
}

/**
 * Whatever the human typed → the stored form, or null if it cannot be a code.
 *
 * Case-insensitive, and dashes/spaces anywhere are ignored, so `wxyz-2345`,
 * `WXYZ 2345` and `wxyz2345` all match. Characters outside the alphabet are
 * rejected rather than "corrected" — guessing that an O meant a 0 would just
 * turn a typo into a lookup of somebody else's code.
 */
export function normaliseUserCode(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null
  const compact = input.replace(/[\s-]/g, '').toUpperCase()
  return USER_CODE_RE.test(compact) ? compact : null
}

// ---------------------------------------------------------------------------
// Device code — the CLI's secret for polling
// ---------------------------------------------------------------------------

/** 32 random bytes, base64url: 43 characters, 256 bits. Never stored. */
export function generateDeviceCode(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * hex(sha256(device_code)) — what the database holds.
 *
 * A plain hash, not a peppered HMAC like API keys: the input is 256 bits of
 * randomness that lives for 10 minutes, so there is nothing to brute-force, and
 * the row is useless once consumed or expired.
 */
export function hashDeviceCode(deviceCode: string): string {
  return createHash('sha256').update(deviceCode, 'utf8').digest('hex')
}

/** Cheap shape check before touching the database. */
export function isPlausibleDeviceCode(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value)
}

// ---------------------------------------------------------------------------
// Client metadata — self-reported, shown to the human, used in the key name
// ---------------------------------------------------------------------------

const CLIENT_FIELD_MAX = 64

/**
 * Trim, drop control characters, collapse whitespace and cap the length.
 * The value is rendered on the consent screen and ends up in a key name, so it
 * must not be able to smuggle in newlines or a novel.
 */
export function sanitiseClientField(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, CLIENT_FIELD_MAX)
    .trim()
  return cleaned || null
}

/** What the key is called in Settings → API keys. */
export function cliKeyName(clientName: string | null | undefined): string {
  return `CLI · ${sanitiseClientField(clientName) ?? 'Unknown device'}`
}

// ---------------------------------------------------------------------------
// Token endpoint outcomes → HTTP (RFC 8628 §3.5)
// ---------------------------------------------------------------------------

export type PollOutcome =
  | 'authorization_pending'
  | 'slow_down'
  | 'access_denied'
  | 'expired_token'
  | 'invalid_grant'
  | 'approved'

export type TokenErrorCode =
  | Exclude<PollOutcome, 'approved'>
  | 'invalid_request'
  | 'rate_limited'
  | 'server_error'

const DESCRIPTIONS: Record<TokenErrorCode, string> = {
  authorization_pending: 'Waiting for you to approve this login in the browser.',
  slow_down: `Polling too fast. Wait at least ${POLL_INTERVAL_SECONDS} seconds between requests.`,
  access_denied: 'The login request was denied in the browser.',
  expired_token: 'The login request expired. Run the login command again.',
  invalid_grant: 'Unknown or already-used device code. Run the login command again.',
  invalid_request: 'Send a JSON body with a device_code.',
  rate_limited: 'Too many requests. Try again shortly.',
  server_error: 'Something went wrong on our side. Try logging in again.',
}

const STATUS: Record<TokenErrorCode, number> = {
  authorization_pending: 400,
  slow_down: 400,
  access_denied: 400,
  expired_token: 400,
  invalid_grant: 400,
  invalid_request: 400,
  rate_limited: 429,
  server_error: 500,
}

export interface TokenErrorBody {
  error: TokenErrorCode
  error_description: string
}

export function tokenError(code: TokenErrorCode): { status: number; body: TokenErrorBody } {
  return { status: STATUS[code], body: { error: code, error_description: DESCRIPTIONS[code] } }
}

// ---------------------------------------------------------------------------
// Lifecycle — mirrors the state machine enforced in SQL (0013)
// ---------------------------------------------------------------------------

export type DeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'

/**
 * Legal transitions. The database functions are the enforcement; this is the
 * specification they are tested against, and what the UI uses to decide what a
 * status means.
 *
 * consumed → approved exists for one case only: the key mint failed after the
 * poll claimed the row (cli_device_release), so the next poll can retry.
 */
export const TRANSITIONS: Record<DeviceStatus, readonly DeviceStatus[]> = {
  pending: ['approved', 'denied', 'expired'],
  approved: ['consumed', 'expired'],
  consumed: ['approved'],
  denied: [],
  expired: [],
}

export function canTransition(from: DeviceStatus, to: DeviceStatus): boolean {
  return TRANSITIONS[from].includes(to)
}
