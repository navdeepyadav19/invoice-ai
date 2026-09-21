import { createHash, randomBytes } from 'node:crypto'

/**
 * App-level email verification: the pure half.
 *
 * Supabase's own "Confirm email" is off so people can sign in straight after
 * signing up, which means auth.users.email_confirmed_at no longer proves
 * anything. Instead we email a link carrying a random token and store only its
 * SHA-256 (migration 0012). The raw token exists in exactly one place — the
 * email — so a database leak is not a pile of working links.
 *
 * Plain SHA-256 rather than HMAC or bcrypt: the token is 256 random bits, so
 * there is nothing to brute-force and nothing a pepper would add.
 *
 * Everything here is pure so it can be unit tested without a database.
 */

/**
 * Whether to show the "unverified" banner and badge.
 *
 * Guests have no email to verify. The check is `=== null`, not falsy, on
 * purpose: if this code ships before migration 0012 is applied the column is
 * simply absent (undefined), and we'd rather show nothing than tell every
 * existing user they're unverified.
 */
export function isEmailUnverified(
  user: { is_anonymous?: boolean; email?: string | null } | null,
  profile: { email_verified_at?: string | null } | null,
): boolean {
  if (!user || user.is_anonymous || !user.email) return false
  return profile?.email_verified_at === null
}

/** Must match the column default in 0012_email_verification.sql. */
export const VERIFICATION_TTL_HOURS = 24

/** Must match the rate-limit window in create_email_verification(). */
export const RESEND_COOLDOWN_SECONDS = 60

/** 32 random bytes, base64url: 43 URL-safe characters, no padding. */
export function generateVerificationToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Lowercase hex SHA-256 — the only form of the token the database sees. */
export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/**
 * Cheap shape check before touching the database, so a mangled link (an email
 * client that wrapped it, a trailing period) gets a friendly "invalid" rather
 * than a round trip.
 */
export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

export function verificationUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}/auth/verify?token=${encodeURIComponent(token)}`
}

/** What create_email_verification() can answer. */
export type CreateVerificationResult = 'created' | 'rate_limited' | 'already_verified' | 'no_email'

/** What redeem_email_verification() can answer. */
export type RedeemVerificationResult =
  | 'verified'
  | 'already_verified'
  | 'expired'
  | 'used'
  | 'email_changed'
  | 'invalid'

const REDEEM_RESULTS: readonly RedeemVerificationResult[] = [
  'verified',
  'already_verified',
  'expired',
  'used',
  'email_changed',
  'invalid',
]

/** Narrows an untrusted string (an RPC result or a query param) to a known outcome. */
export function toRedeemResult(value: unknown): RedeemVerificationResult {
  return REDEEM_RESULTS.includes(value as RedeemVerificationResult)
    ? (value as RedeemVerificationResult)
    : 'invalid'
}

/**
 * Copy for the /verify-email result page. `body` says what happened; failures
 * get a separate next step that depends on whether the reader is signed in
 * (the resend button lives in the signed-in app's banner).
 */
export function describeRedeemResult(
  result: RedeemVerificationResult,
  signedIn = false,
): { title: string; body: string; ok: boolean } {
  const nextStep = signedIn
    ? 'Use “Resend verification email” in the banner to get a fresh link.'
    : 'Sign in and use “Resend verification email” to get a fresh link.'

  switch (result) {
    case 'verified':
      return { ok: true, title: 'Email verified', body: 'Thanks — your email address is confirmed.' }
    case 'already_verified':
      return {
        ok: true,
        title: 'Already verified',
        body: 'This email address was already confirmed. You’re all set.',
      }
    case 'expired':
      return {
        ok: false,
        title: 'That link has expired',
        body: `Verification links last ${VERIFICATION_TTL_HOURS} hours. ${nextStep}`,
      }
    case 'used':
      return {
        ok: false,
        title: 'That link was already used',
        body: `Each link works once. ${nextStep}`,
      }
    case 'email_changed':
      return {
        ok: false,
        title: 'Your email has changed',
        body: `This link was sent to a different address than the one on your account. ${nextStep}`,
      }
    case 'invalid':
      return {
        ok: false,
        title: 'That link isn’t valid',
        body: `It may have been copied incompletely. ${nextStep}`,
      }
  }
}
