/**
 * Auth errors are written for developers ("USER_ALREADY_EXISTS", "Invalid
 * email or password"). This maps the ones a real person will actually hit to
 * something they can act on, and passes anything unrecognised through
 * unchanged rather than hiding it behind a generic "something went wrong".
 *
 * Neon Auth is managed Better Auth. Its server SDK returns errors shaped
 * `{ code, message, status }`, and it normalizes the better-known Better Auth
 * codes to snake_case ones (USER_ALREADY_EXISTS → user_already_exists,
 * INVALID_EMAIL_OR_PASSWORD → invalid_credentials) while passing the rest
 * through. Both spellings are matched, then the status, then the message text.
 */

export interface AuthErrorLike {
  code?: string | null
  message?: string | null
  status?: number | null
}

const ACCOUNT_EXISTS = 'An account with this email already exists. Sign in instead.'
const BAD_CREDENTIALS = 'That email and password don’t match. Check them and try again.'
const TOO_MANY = 'Too many attempts. Wait a minute and try again.'
const WEAK_PASSWORD = 'Choose a stronger password — at least 8 characters, and not a common one.'
const PASSWORD_TOO_LONG = 'That password is too long. Use 128 characters or fewer.'
const INVALID_EMAIL = 'Enter a valid email address.'
const INVALID_LINK = 'That reset link is invalid or has expired. Request a new one.'
const EMAIL_NOT_VERIFIED = 'Confirm your email first — check your inbox for the link we sent.'

/** Better Auth codes, and the snake_case codes Neon Auth normalizes them to. */
const CODES: Record<string, string> = {
  USER_ALREADY_EXISTS: ACCOUNT_EXISTS,
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: ACCOUNT_EXISTS,
  user_already_exists: ACCOUNT_EXISTS,
  email_exists: ACCOUNT_EXISTS,

  INVALID_EMAIL_OR_PASSWORD: BAD_CREDENTIALS,
  INVALID_PASSWORD: BAD_CREDENTIALS,
  invalid_credentials: BAD_CREDENTIALS,

  INVALID_EMAIL: INVALID_EMAIL,
  email_address_invalid: INVALID_EMAIL,

  PASSWORD_TOO_SHORT: WEAK_PASSWORD,
  weak_password: WEAK_PASSWORD,
  PASSWORD_TOO_LONG: PASSWORD_TOO_LONG,

  // A reset token that was never issued, already used, or past its hour.
  // Neon Auth reports Better Auth's INVALID_TOKEN as bad_jwt.
  INVALID_TOKEN: INVALID_LINK,
  bad_jwt: INVALID_LINK,

  TOO_MANY_REQUESTS: TOO_MANY,
  over_request_rate_limit: TOO_MANY,
  over_email_send_rate_limit: TOO_MANY,

  EMAIL_NOT_VERIFIED: EMAIL_NOT_VERIFIED,
  email_not_confirmed: EMAIL_NOT_VERIFIED,
}

/** Message-text fallbacks, for errors that arrive without a recognisable code. */
const RULES: { test: RegExp; message: string }[] = [
  {
    test: /already (been )?registered|already exists|email_exists|user_already_exists/i,
    message: ACCOUNT_EXISTS,
  },
  {
    test: /invalid (login credentials|email or password)/i,
    message: BAD_CREDENTIALS,
  },
  {
    test: /email not (confirmed|verified)/i,
    message: EMAIL_NOT_VERIFIED,
  },
  {
    test: /rate limit|too many (requests|attempts)|security purposes/i,
    message: TOO_MANY,
  },
  {
    test: /password (should be|too short)|weak password|pwned/i,
    message: WEAK_PASSWORD,
  },
  {
    test: /signups? not allowed|signup is disabled/i,
    message: 'New sign-ups are switched off right now.',
  },
]

function normalize(error: AuthErrorLike | string | null | undefined): AuthErrorLike {
  if (!error) return {}
  return typeof error === 'string' ? { message: error } : error
}

/**
 * A sentence to show the user. Accepts the SDK's error object or, for older
 * call sites, a bare message string.
 */
export function friendlyAuthError(error: AuthErrorLike | string | null | undefined): string {
  const { code, message, status } = normalize(error)

  if (code && CODES[code]) return CODES[code]
  if (status === 429) return TOO_MANY

  if (!message) return 'Something went wrong. Try again.'
  return RULES.find((rule) => rule.test.test(message))?.message ?? message
}

/**
 * True when the failure means "this email already has an account". Takes the
 * raw error or the sentence friendlyAuthError produced from it, which is what a
 * form gets back in its state.
 */
export function isAccountExistsError(error: AuthErrorLike | string | null | undefined): boolean {
  const { code, message } = normalize(error)
  if (code && CODES[code] === ACCOUNT_EXISTS) return true
  return Boolean(message && (message === ACCOUNT_EXISTS || RULES[0].test.test(message)))
}
