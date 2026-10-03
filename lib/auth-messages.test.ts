import { describe, expect, it } from 'vitest'

import { friendlyAuthError, isAccountExistsError } from './auth-messages'

const EXISTS = /already exists\. Sign in instead/
const BAD_CREDENTIALS = /don’t match/
const TOO_MANY = /Too many attempts/
const WEAK = /stronger password/
const LINK = /reset link is invalid or has expired/

describe('friendlyAuthError — Better Auth codes', () => {
  it('maps duplicate-account codes, raw and as Neon Auth normalizes them', () => {
    expect(friendlyAuthError({ code: 'USER_ALREADY_EXISTS' })).toMatch(EXISTS)
    expect(friendlyAuthError({ code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL' })).toMatch(EXISTS)
    expect(friendlyAuthError({ code: 'user_already_exists', message: 'User already exists' })).toMatch(EXISTS)
  })

  it('maps the unknown-code fallback Neon Auth gives USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL', () => {
    expect(
      friendlyAuthError({
        code: 'validation_failed',
        message: 'User already exists. Use another email.',
        status: 422,
      }),
    ).toMatch(EXISTS)
  })

  it('maps bad credentials without revealing which half was wrong', () => {
    expect(friendlyAuthError({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toMatch(BAD_CREDENTIALS)
    expect(friendlyAuthError({ code: 'invalid_credentials', status: 401 })).toMatch(BAD_CREDENTIALS)
  })

  it('maps email and password validation codes', () => {
    expect(friendlyAuthError({ code: 'INVALID_EMAIL' })).toBe('Enter a valid email address.')
    expect(friendlyAuthError({ code: 'PASSWORD_TOO_SHORT' })).toMatch(WEAK)
    expect(friendlyAuthError({ code: 'weak_password' })).toMatch(WEAK)
    expect(friendlyAuthError({ code: 'PASSWORD_TOO_LONG' })).toMatch(/too long/)
  })

  it('maps an invalid or expired reset token', () => {
    expect(friendlyAuthError({ code: 'INVALID_TOKEN' })).toMatch(LINK)
    expect(friendlyAuthError({ code: 'bad_jwt', status: 400 })).toMatch(LINK)
  })

  it('maps rate limits by code and by status alone', () => {
    expect(friendlyAuthError({ code: 'TOO_MANY_REQUESTS' })).toMatch(TOO_MANY)
    expect(friendlyAuthError({ code: 'over_request_rate_limit' })).toMatch(TOO_MANY)
    expect(friendlyAuthError({ status: 429, message: 'Slow down' })).toMatch(TOO_MANY)
  })

  it('maps an unverified email', () => {
    expect(friendlyAuthError({ code: 'EMAIL_NOT_VERIFIED' })).toMatch(/Confirm your email/)
  })

  it('prefers the code over the message', () => {
    expect(friendlyAuthError({ code: 'USER_ALREADY_EXISTS', message: 'Database on fire' })).toMatch(EXISTS)
  })
})

describe('friendlyAuthError — message fallbacks', () => {
  it('still understands bare message strings', () => {
    expect(friendlyAuthError('User already registered')).toMatch(EXISTS)
    expect(friendlyAuthError('Invalid email or password')).toMatch(BAD_CREDENTIALS)
    expect(friendlyAuthError('Email rate limit exceeded')).toMatch(TOO_MANY)
  })

  it('passes unknown messages through, codes included', () => {
    expect(friendlyAuthError('Database on fire')).toBe('Database on fire')
    expect(friendlyAuthError({ code: 'SOMETHING_NEW', message: 'Database on fire' })).toBe('Database on fire')
  })

  it('handles empty input', () => {
    expect(friendlyAuthError(undefined)).toMatch(/Something went wrong/)
    expect(friendlyAuthError(null)).toMatch(/Something went wrong/)
    expect(friendlyAuthError({})).toMatch(/Something went wrong/)
  })
})

describe('isAccountExistsError', () => {
  it('recognises the raw error and the friendly sentence a form gets back', () => {
    expect(isAccountExistsError({ code: 'USER_ALREADY_EXISTS' })).toBe(true)
    expect(isAccountExistsError('User already registered')).toBe(true)
    expect(isAccountExistsError(friendlyAuthError({ code: 'user_already_exists' }))).toBe(true)
  })

  it('is false for everything else', () => {
    expect(isAccountExistsError({ code: 'INVALID_EMAIL_OR_PASSWORD' })).toBe(false)
    expect(isAccountExistsError('Invalid login credentials')).toBe(false)
    expect(isAccountExistsError(undefined)).toBe(false)
  })
})
