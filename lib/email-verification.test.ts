import { describe, expect, it } from 'vitest'

import { friendlyAuthError, isAccountExistsError } from './auth-messages'
import {
  describeRedeemResult,
  generateVerificationToken,
  hashVerificationToken,
  isEmailUnverified,
  isWellFormedToken,
  toRedeemResult,
  verificationUrl,
} from './email-verification'

describe('verification tokens', () => {
  it('generates 43-char base64url tokens that are unique', () => {
    const a = generateVerificationToken()
    const b = generateVerificationToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
    expect(isWellFormedToken(a)).toBe(true)
  })

  it('hashes to lowercase hex SHA-256 that matches the DB check constraint', () => {
    // Known vector: sha256("abc")
    expect(hashVerificationToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hashVerificationToken(generateVerificationToken())).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic, so the link can be matched to the stored hash', () => {
    const token = generateVerificationToken()
    expect(hashVerificationToken(token)).toBe(hashVerificationToken(token))
  })

  it('rejects malformed tokens before a database round trip', () => {
    expect(isWellFormedToken(undefined)).toBe(false)
    expect(isWellFormedToken('')).toBe(false)
    expect(isWellFormedToken('short')).toBe(false)
    expect(isWellFormedToken(`${generateVerificationToken()}.`)).toBe(false)
    expect(isWellFormedToken('a'.repeat(42) + '/')).toBe(false)
  })

  it('builds the link on the canonical origin, tolerating a trailing slash', () => {
    expect(verificationUrl('https://app.example.com/', 'tok_-1')).toBe(
      'https://app.example.com/auth/verify?token=tok_-1',
    )
  })
})

describe('redeem results', () => {
  it('narrows unknown values to invalid', () => {
    expect(toRedeemResult('verified')).toBe('verified')
    expect(toRedeemResult('expired')).toBe('expired')
    expect(toRedeemResult('nonsense')).toBe('invalid')
    expect(toRedeemResult(null)).toBe('invalid')
  })

  it('marks only success outcomes as ok', () => {
    expect(describeRedeemResult('verified').ok).toBe(true)
    expect(describeRedeemResult('already_verified').ok).toBe(true)
    expect(describeRedeemResult('expired').ok).toBe(false)
    expect(describeRedeemResult('expired').body).toContain('24 hours')
    expect(describeRedeemResult('expired').body).toContain('Sign in')
    expect(describeRedeemResult('expired', true).body).not.toContain('Sign in')
  })
})

describe('friendlyAuthError', () => {
  it('maps a duplicate signup to a sign-in prompt', () => {
    expect(friendlyAuthError('User already registered')).toBe(
      'An account with this email already exists. Sign in instead.',
    )
    expect(isAccountExistsError('User already registered')).toBe(true)
    expect(isAccountExistsError('Invalid login credentials')).toBe(false)
  })

  it('maps rate limits', () => {
    expect(friendlyAuthError('Email rate limit exceeded')).toMatch(/Too many attempts/)
  })

  it('passes unknown messages through and handles empty input', () => {
    expect(friendlyAuthError('Database on fire')).toBe('Database on fire')
    expect(friendlyAuthError(undefined)).toMatch(/Something went wrong/)
  })
})

describe('isEmailUnverified', () => {
  const user = { email: 'a@b.co', is_anonymous: false }

  it('is true only for a signed-in email user with a null verified stamp', () => {
    expect(isEmailUnverified(user, { email_verified_at: null })).toBe(true)
    expect(isEmailUnverified(user, { email_verified_at: '2026-01-01T00:00:00Z' })).toBe(false)
  })

  it('stays quiet for guests, missing users and a pre-migration schema', () => {
    expect(isEmailUnverified({ is_anonymous: true, email: null }, { email_verified_at: null })).toBe(false)
    expect(isEmailUnverified(null, null)).toBe(false)
    expect(isEmailUnverified(user, {})).toBe(false)
    expect(isEmailUnverified(user, null)).toBe(false)
  })
})
