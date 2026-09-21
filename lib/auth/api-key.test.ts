import { beforeAll, describe, expect, it } from 'vitest'

import {
  checkValidity,
  generateApiKey,
  hashSecret,
  parseApiKey,
  secretMatches,
} from './api-key'

beforeAll(() => {
  process.env.API_KEY_PEPPER = 'test-pepper-not-the-real-one'
})

describe('API key format', () => {
  it('produces a key whose prefix is a parseable half of itself', () => {
    const key = generateApiKey()

    expect(key.plaintext.startsWith('inv_live_')).toBe(true)
    expect(key.plaintext.startsWith(key.prefix)).toBe(true)

    const parsed = parseApiKey(key.plaintext)
    expect(parsed?.prefix).toBe(key.prefix)
  })

  it('never returns the same key twice', () => {
    const keys = new Set(Array.from({ length: 200 }, () => generateApiKey().plaintext))
    expect(keys.size).toBe(200)
  })

  /**
   * The prefix is what a secret scanner matches on. If it ever stops being a
   * literal, GitHub's scanning and our own log scrubbers go quiet without
   * anything failing.
   */
  it('keeps the greppable literal prefix', () => {
    expect(generateApiKey().prefix).toMatch(/^inv_live_[A-Za-z0-9]{8}$/)
  })

  it.each([
    ['empty', ''],
    ['wrong scheme', 'sk_live_abcdefgh_' + 'a'.repeat(32)],
    ['too few parts', 'inv_live_abcdefgh'],
    ['short id', 'inv_live_abc_' + 'a'.repeat(32)],
    ['short secret', 'inv_live_abcdefgh_tooshort'],
    ['non-base62 secret', 'inv_live_abcdefgh_' + '!'.repeat(32)],
  ])('rejects a malformed key: %s', (_label, candidate) => {
    expect(parseApiKey(candidate)).toBeNull()
  })
})

describe('secret hashing', () => {
  it('stores a hash, never the secret', () => {
    const key = generateApiKey()
    const secret = key.plaintext.split('_')[3]

    expect(key.secretHash).not.toContain(secret)
    expect(key.secretHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('verifies the right secret and rejects a near-miss', () => {
    const key = generateApiKey()
    const secret = key.plaintext.split('_')[3]

    expect(secretMatches(secret, key.secretHash)).toBe(true)

    // Flip one character: everything else about the key is identical.
    const almost = (secret[0] === 'a' ? 'b' : 'a') + secret.slice(1)
    expect(secretMatches(almost, key.secretHash)).toBe(false)
  })

  /**
   * The pepper is what makes a stolen database dump useless. If hashing ever
   * stopped depending on it, that property would disappear silently.
   */
  it('depends on the pepper', () => {
    const before = hashSecret('a-fixed-secret')
    process.env.API_KEY_PEPPER = 'a-different-pepper'
    const after = hashSecret('a-fixed-secret')
    process.env.API_KEY_PEPPER = 'test-pepper-not-the-real-one'

    expect(after).not.toBe(before)
  })

  it('refuses to hash at all when the pepper is missing', () => {
    const saved = process.env.API_KEY_PEPPER
    delete process.env.API_KEY_PEPPER

    // Defaulting to '' would hash every key with an empty secret, and those
    // hashes would be verifiable by anyone holding the database.
    expect(() => hashSecret('whatever')).toThrow(/API_KEY_PEPPER/)

    process.env.API_KEY_PEPPER = saved
  })

  it('returns false rather than throwing on a length mismatch', () => {
    // timingSafeEqual throws when the buffers differ in length, which would be
    // a 500 on a malformed stored hash instead of a clean 401.
    expect(secretMatches('anything', 'short')).toBe(false)
  })
})

describe('validity', () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const past = new Date(Date.now() - 86_400_000).toISOString()

  it('accepts a live key', () => {
    expect(checkValidity({ revoked_at: null, expires_at: null })).toEqual({ ok: true })
    expect(checkValidity({ revoked_at: null, expires_at: future })).toEqual({ ok: true })
  })

  it('rejects an expired key', () => {
    expect(checkValidity({ revoked_at: null, expires_at: past })).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('reports revocation ahead of expiry', () => {
    // A key that was revoked AND has since expired should say "revoked" — that
    // is the fact the user acted on and expects to see.
    expect(checkValidity({ revoked_at: past, expires_at: past })).toEqual({
      ok: false,
      reason: 'revoked',
    })
  })
})
