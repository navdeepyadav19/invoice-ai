import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'

import {
  TRANSITIONS,
  USER_CODE_ALPHABET,
  canTransition,
  cliKeyName,
  formatUserCode,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  isPlausibleDeviceCode,
  normaliseUserCode,
  sanitiseClientField,
  tokenError,
  type DeviceStatus,
} from './device'
import { CLI_DEFAULT_SCOPES } from './scopes'
import { SCOPES } from '@/lib/auth/scopes'

describe('user codes', () => {
  it('generates 8 characters from the unambiguous alphabet', () => {
    for (let i = 0; i < 500; i++) {
      const code = generateUserCode()
      expect(code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ2-9]{8}$/)
    }
  })

  it('never uses vowels, Y, 0 or 1', () => {
    expect(USER_CODE_ALPHABET).toHaveLength(28)
    expect(USER_CODE_ALPHABET).not.toMatch(/[AEIOUY01]/)
  })

  it('uses the whole alphabet (no modulo bias starving the tail)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 400; i++) for (const c of generateUserCode()) seen.add(c)
    expect(seen.size).toBe(USER_CODE_ALPHABET.length)
  })

  it('formats as XXXX-XXXX', () => {
    expect(formatUserCode('WXZB2345')).toBe('WXZB-2345')
    expect(formatUserCode('wxzb-2345')).toBe('WXZB-2345')
  })

  it.each([
    ['WXZB-2345', 'WXZB2345'],
    ['wxzb-2345', 'WXZB2345'],
    ['wxzb2345', 'WXZB2345'],
    ['  WXZB 2345 ', 'WXZB2345'],
    ['W-X-Z-B-2-3-4-5', 'WXZB2345'],
  ])('normalises %j', (input, expected) => {
    expect(normaliseUserCode(input)).toBe(expected)
  })

  it.each([
    ['too short', 'WXZB-234'],
    ['too long', 'WXZB-23456'],
    ['contains a vowel', 'WAZB-2345'],
    ['contains a zero', 'WXZB-2340'],
    ['contains an O (not silently corrected to 0)', 'WXZB-234O'],
    ['punctuation', 'WXZB.2345'],
    ['empty', ''],
  ])('rejects %s', (_label, input) => {
    expect(normaliseUserCode(input)).toBeNull()
  })

  it('rejects non-strings', () => {
    expect(normaliseUserCode(null)).toBeNull()
    expect(normaliseUserCode(undefined)).toBeNull()
  })
})

describe('device codes', () => {
  it('is 32 bytes of base64url (43 chars)', () => {
    const code = generateDeviceCode()
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(code, 'base64url')).toHaveLength(32)
    expect(isPlausibleDeviceCode(code)).toBe(true)
  })

  it('is unique per call', () => {
    const codes = new Set(Array.from({ length: 100 }, generateDeviceCode))
    expect(codes.size).toBe(100)
  })

  it('stores only the hex SHA-256', () => {
    const code = generateDeviceCode()
    const hash = hashDeviceCode(code)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
    expect(hash).toBe(createHash('sha256').update(code).digest('hex'))
    expect(hash).not.toContain(code)
    expect(hashDeviceCode(code)).toBe(hash)
  })

  it.each([[''], ['short'], ['has spaces in it and is long enough to pass length'], [42], [null]])(
    'rejects implausible %j before touching the database',
    (value) => {
      expect(isPlausibleDeviceCode(value)).toBe(false)
    },
  )
})

describe('client metadata', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(sanitiseClientField('navdeep-mbp\n\r\tevil')).toBe('navdeep-mbp evil')
    expect(sanitiseClientField('a‮b')).toBe('a b')
  })

  it('caps the length at 64', () => {
    expect(sanitiseClientField('x'.repeat(200))).toHaveLength(64)
  })

  it('returns null for blank or non-string input', () => {
    expect(sanitiseClientField('   ')).toBeNull()
    expect(sanitiseClientField(undefined)).toBeNull()
    expect(sanitiseClientField({})).toBeNull()
  })

  it('names the key CLI · <client>', () => {
    expect(cliKeyName('navdeep-mbp')).toBe('CLI · navdeep-mbp')
    expect(cliKeyName('')).toBe('CLI · Unknown device')
    expect(cliKeyName(null)).toBe('CLI · Unknown device')
  })
})

describe('default CLI scopes', () => {
  it('pre-ticks every non-admin scope', () => {
    expect([...CLI_DEFAULT_SCOPES]).toEqual(SCOPES.filter((s) => !s.endsWith(':admin')))
    expect(CLI_DEFAULT_SCOPES.length).toBeGreaterThan(0)
  })
})

describe('token errors (RFC 8628 §3.5)', () => {
  it.each([
    'authorization_pending',
    'slow_down',
    'access_denied',
    'expired_token',
    'invalid_grant',
    'invalid_request',
  ] as const)('%s is a 400 with the code in `error`', (code) => {
    const { status, body } = tokenError(code)
    expect(status).toBe(400)
    expect(body.error).toBe(code)
    expect(body.error_description).toBeTruthy()
  })

  it('rate limiting is a 429 and a server failure a 500', () => {
    expect(tokenError('rate_limited').status).toBe(429)
    expect(tokenError('server_error').status).toBe(500)
  })
})

describe('lifecycle', () => {
  const all: DeviceStatus[] = ['pending', 'approved', 'denied', 'consumed', 'expired']

  it('a pending login can be approved, denied or expire', () => {
    expect(canTransition('pending', 'approved')).toBe(true)
    expect(canTransition('pending', 'denied')).toBe(true)
    expect(canTransition('pending', 'expired')).toBe(true)
    expect(canTransition('pending', 'consumed')).toBe(false)
  })

  it('an approved login is consumed by exactly one poll, or expires', () => {
    expect(canTransition('approved', 'consumed')).toBe(true)
    expect(canTransition('approved', 'expired')).toBe(true)
    expect(canTransition('approved', 'denied')).toBe(false)
    expect(canTransition('approved', 'pending')).toBe(false)
  })

  it('consumed can only be released back to approved (failed mint)', () => {
    expect(TRANSITIONS.consumed).toEqual(['approved'])
  })

  it('denied and expired are terminal', () => {
    for (const to of all) {
      expect(canTransition('denied', to)).toBe(false)
      expect(canTransition('expired', to)).toBe(false)
    }
  })

  it('nothing ever returns to pending', () => {
    for (const from of all) expect(canTransition(from, 'pending')).toBe(false)
  })
})
