import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * API key format, and why each part is shaped the way it is.
 *
 *     inv_live_ab12cd34_7Kf9QmXz2pR4vNt6LwYb8HsJ3dGc5eAu
 *     └──┬───┘ └──┬───┘ └───────────────┬──────────────┘
 *        │        │                     │
 *        │        │                     └─ 32 chars of base62 ≈ 190 bits.
 *        │        │                        Never stored. Shown once.
 *        │        └─ 8-char public id. Stored in the clear; it is how we find
 *        │           the row to check against without scanning every hash.
 *        └─ Fixed, greppable marker. GitHub secret scanning and your own log
 *           scrubbers can match `inv_live_` — an opaque blob of base64 is
 *           indistinguishable from any other token and slips through.
 *
 * `live` is there so a future `inv_test_` needs no format change.
 */

const KEY_PREFIX = 'inv_live'
const ID_LENGTH = 8
const SECRET_LENGTH = 32

// Base62: URL-safe, double-click-selectable, and no characters that a user can
// confuse when reading a key aloud or out of a terminal.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export interface GeneratedKey {
  /** The only time the full key exists. Show it once, then forget it. */
  plaintext: string
  /** Public half, stored and displayed in the settings list. */
  prefix: string
  /** HMAC-SHA256(pepper, secret). What actually goes in the database. */
  secretHash: string
}

export function generateApiKey(): GeneratedKey {
  const id = randomString(ID_LENGTH)
  const secret = randomString(SECRET_LENGTH)
  const prefix = `${KEY_PREFIX}_${id}`

  return {
    plaintext: `${prefix}_${secret}`,
    prefix,
    secretHash: hashSecret(secret),
  }
}

export interface ParsedKey {
  prefix: string
  secret: string
}

/**
 * Split a presented key without trusting any of it.
 *
 * Returns null rather than throwing: a malformed Authorization header is an
 * ordinary 401, not an exceptional condition, and it arrives constantly from
 * scanners.
 */
export function parseApiKey(raw: string): ParsedKey | null {
  const value = raw.trim()
  const parts = value.split('_')

  // inv, live, id, secret
  if (parts.length !== 4) return null
  if (`${parts[0]}_${parts[1]}` !== KEY_PREFIX) return null
  if (parts[2].length !== ID_LENGTH || parts[3].length !== SECRET_LENGTH) return null
  if (!isBase62(parts[2]) || !isBase62(parts[3])) return null

  return { prefix: `${parts[0]}_${parts[1]}_${parts[2]}`, secret: parts[3] }
}

/**
 * Peppered HMAC.
 *
 * The pepper lives in the environment, never in the database. A read-only leak
 * of `api_keys` therefore yields hashes that cannot be checked against any
 * candidate secret, because the attacker is missing the key to the HMAC.
 *
 * Not bcrypt/argon2 on purpose: the secret is 190 bits of uniform randomness,
 * so there is no dictionary to slow down, and a deliberately slow hash would add
 * ~100ms to every authenticated API request for no security gain.
 */
export function hashSecret(secret: string): string {
  return createHmac('sha256', pepper()).update(secret).digest('hex')
}

/**
 * Compare in constant time.
 *
 * A plain `===` on a hash leaks, through timing, how many leading characters a
 * guess got right — which turns a 190-bit search into a character-by-character
 * one. timingSafeEqual takes the same time whatever the inputs.
 *
 * It throws on length mismatch, so the lengths are checked first — and that
 * check is safe to do in variable time because the length of a hex SHA-256
 * digest is public knowledge.
 */
export function secretMatches(secret: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), 'utf8')
  const stored = Buffer.from(storedHash, 'utf8')

  if (candidate.length !== stored.length) return false
  return timingSafeEqual(candidate, stored)
}

export interface KeyValidity {
  ok: boolean
  reason?: 'revoked' | 'expired'
}

export function checkValidity(key: {
  revoked_at: string | null
  expires_at: string | null
}): KeyValidity {
  // Revocation is checked before expiry so a revoked-and-expired key reports the
  // reason the user actually acted on.
  if (key.revoked_at) return { ok: false, reason: 'revoked' }
  if (key.expires_at && new Date(key.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' }
  }
  return { ok: true }
}

/** Shown in the settings list: inv_live_ab12cd34…  */
export function displayPrefix(prefix: string): string {
  return `${prefix}…`
}

// ---------------------------------------------------------------------------

function pepper(): string {
  const value = process.env.API_KEY_PEPPER
  if (!value) {
    // Failing loudly beats defaulting to a constant. A missing pepper that
    // silently became '' would hash every key with an empty secret, and the
    // resulting hashes would be verifiable by anyone holding the database.
    throw new Error('API_KEY_PEPPER is not set. API key authentication cannot run without it.')
  }
  return value
}

function randomString(length: number): string {
  // rejection-free: 62 does not divide 256, so mapping bytes with % 62 biases
  // the first 8 characters of the alphabet. Drawing from a 4x buffer and
  // rejecting out-of-range bytes keeps the distribution uniform.
  const out: string[] = []
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte < 248) {
        out.push(ALPHABET[byte % 62])
        if (out.length === length) break
      }
    }
  }
  return out.join('')
}

function isBase62(value: string): boolean {
  return /^[A-Za-z0-9]+$/.test(value)
}
