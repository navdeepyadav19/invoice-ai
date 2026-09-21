/**
 * Supabase auth errors are written for developers ("User already registered",
 * "Email rate limit exceeded"). This maps the ones a real person will actually
 * hit to something they can act on, and passes anything unrecognised through
 * unchanged rather than hiding it behind a generic "something went wrong".
 *
 * Matching is on message text because that is what supabase-js surfaces
 * consistently across versions; `error.code` is missing on older projects.
 */
const RULES: { test: RegExp; message: string }[] = [
  {
    test: /already (been )?registered|already exists|email_exists|user_already_exists/i,
    message: 'An account with this email already exists. Sign in instead.',
  },
  {
    test: /invalid login credentials/i,
    message: 'That email and password don’t match. Check them and try again.',
  },
  {
    test: /email not confirmed/i,
    message: 'Confirm your email first — check your inbox for the link we sent.',
  },
  {
    test: /rate limit|too many requests|security purposes/i,
    message: 'Too many attempts. Wait a minute and try again.',
  },
  {
    test: /password should be|weak password|pwned/i,
    message: 'Choose a stronger password — at least 8 characters, and not a common one.',
  },
  {
    test: /signups? not allowed|signup is disabled/i,
    message: 'New sign-ups are switched off right now.',
  },
]

export function friendlyAuthError(message: string | undefined | null): string {
  if (!message) return 'Something went wrong. Try again.'
  return RULES.find((rule) => rule.test.test(message))?.message ?? message
}

/** True when the failure means "this email already has an account". */
export function isAccountExistsError(message: string | undefined | null): boolean {
  return Boolean(message && RULES[0].test.test(message))
}
