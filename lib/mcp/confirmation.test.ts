import { beforeEach, describe, expect, it } from 'vitest'

import { signConfirmation, stableJson, stateHash, verifyConfirmation, type ConfirmationClaims } from './confirmation'

const invoice = {
  id: 'in_1',
  status: 'draft',
  updated: '2026-10-05T09:00:00.000Z',
  total: 165000,
  currency: 'USD',
  customer: 'cus_1',
  lines: { data: [{}] },
}

function claims(overrides: Partial<ConfirmationClaims> = {}): ConfirmationClaims {
  return {
    action: 'send',
    invoiceId: 'in_1',
    stateHash: stateHash(invoice, { to: 'ap@acme.example' }),
    credential: 'key-1',
    userId: 'user-1',
    ...overrides,
  }
}

beforeEach(() => {
  process.env.API_KEY_PEPPER = 'test-pepper'
})

describe('confirmation tokens', () => {
  it('verifies a token for exactly what was previewed', () => {
    const { token, expiresAt } = signConfirmation(claims())

    expect(token).toMatch(/^ct_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(verifyConfirmation(token, claims())).toEqual({ ok: true })
  })

  it('rejects a tampered payload or signature', () => {
    const { token } = signConfirmation(claims())
    const [payload, signature] = token.slice(3).split('.')
    const otherPayload = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), i: 'in_2' }),
    ).toString('base64url')

    expect(verifyConfirmation(`ct_${otherPayload}.${signature}`, claims())).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyConfirmation(`ct_${payload}.${signature.slice(1)}x`, claims())).toEqual({ ok: false, reason: 'malformed' })
    expect(verifyConfirmation('not-a-token', claims())).toEqual({ ok: false, reason: 'malformed' })
  })

  it('rejects a token signed with a different secret', () => {
    const { token } = signConfirmation(claims())
    process.env.API_KEY_PEPPER = 'rotated'
    expect(verifyConfirmation(token, claims()).ok).toBe(false)
  })

  it('expires after ten minutes', () => {
    const issued = Date.now()
    const { token } = signConfirmation(claims(), issued)

    expect(verifyConfirmation(token, claims(), issued + 9 * 60_000).ok).toBe(true)
    expect(verifyConfirmation(token, claims(), issued + 11 * 60_000)).toEqual({ ok: false, reason: 'expired' })
  })

  it('is useless for another action, invoice, connection or user', () => {
    const { token } = signConfirmation(claims())

    expect(verifyConfirmation(token, claims({ action: 'void' }))).toEqual({ ok: false, reason: 'mismatch' })
    expect(verifyConfirmation(token, claims({ invoiceId: 'in_2' }))).toEqual({ ok: false, reason: 'mismatch' })
    expect(verifyConfirmation(token, claims({ credential: 'oauth:grant-9' }))).toEqual({ ok: false, reason: 'mismatch' })
    expect(verifyConfirmation(token, claims({ userId: 'user-2' }))).toEqual({ ok: false, reason: 'mismatch' })
  })

  it('stops applying once the invoice or the action details change', () => {
    const { token } = signConfirmation(claims())

    const edited = stateHash({ ...invoice, updated: '2026-10-05T09:05:00.000Z' }, { to: 'ap@acme.example' })
    const otherRecipient = stateHash(invoice, { to: 'someone@else.example' })

    expect(verifyConfirmation(token, claims({ stateHash: edited }))).toEqual({ ok: false, reason: 'changed' })
    expect(verifyConfirmation(token, claims({ stateHash: otherRecipient }))).toEqual({ ok: false, reason: 'changed' })
  })
})

describe('stableJson', () => {
  it('serialises equal objects identically, whatever the key order', () => {
    expect(stableJson({ b: 1, a: { d: [2, { y: 1, x: 2 }], c: null } })).toBe(stableJson({ a: { c: null, d: [2, { x: 2, y: 1 }] }, b: 1 }))
  })

  it('drops undefined fields, as JSON does', () => {
    expect(stableJson({ a: 1, b: undefined })).toBe('{"a":1}')
  })
})
