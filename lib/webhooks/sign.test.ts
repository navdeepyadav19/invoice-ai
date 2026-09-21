import { describe, expect, it } from 'vitest'

import { generateSecret, sign, signatureHeaders, verify } from './sign'

const SECRET = 'whsec_dGVzdC1zZWNyZXQtZm9yLXVuaXQtdGVzdHM'
const ID = 'msg_2KfTestDelivery'
const BODY = JSON.stringify({ type: 'invoice.issued', data: { invoice_number: 'INV/26-27/0042' } })

describe('signing', () => {
  it('round-trips a signature it just produced', () => {
    const now = Date.now()
    const headers = signatureHeaders(SECRET, ID, BODY, now)

    expect(
      verify({
        secret: SECRET,
        id: headers['webhook-id'],
        timestamp: headers['webhook-timestamp'],
        signature: headers['webhook-signature'],
        body: BODY,
        now,
      }),
    ).toEqual({ ok: true })
  })

  it('carries a version prefix so the scheme can change later', () => {
    expect(sign(SECRET, ID, 1789371234, BODY)).toMatch(/^v1,/)
  })

  it('is deterministic for the same inputs', () => {
    expect(sign(SECRET, ID, 1789371234, BODY)).toBe(sign(SECRET, ID, 1789371234, BODY))
  })
})

describe('verification', () => {
  const now = Date.now()
  const headers = signatureHeaders(SECRET, ID, BODY, now)

  const base = {
    secret: SECRET,
    id: headers['webhook-id'],
    timestamp: headers['webhook-timestamp'],
    signature: headers['webhook-signature'],
    body: BODY,
    now,
  }

  /** The whole point: a receiver must detect an altered payload. */
  it('rejects a tampered body', () => {
    const tampered = BODY.replace('0042', '9999')
    expect(verify({ ...base, body: tampered })).toEqual({
      ok: false,
      reason: 'signature_mismatch',
    })
  })

  it('rejects a wrong secret', () => {
    expect(verify({ ...base, secret: generateSecret() }).ok).toBe(false)
  })

  /**
   * The id and timestamp are inside the signed string, not just alongside it.
   * If they were not, a captured request could be replayed forever and still
   * verify — which is exactly what these two tests prove cannot happen.
   */
  it('rejects a swapped delivery id', () => {
    expect(verify({ ...base, id: 'msg_someOtherDelivery' }).ok).toBe(false)
  })

  it('rejects a replay from six minutes ago', () => {
    expect(verify({ ...base, now: now + 360_000 })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    })
  })

  it('rejects a timestamp far in the future, which usually means a bad clock', () => {
    expect(verify({ ...base, now: now - 360_000 })).toEqual({
      ok: false,
      reason: 'timestamp_out_of_tolerance',
    })
  })

  it('accepts one that is four minutes old, inside the tolerance', () => {
    expect(verify({ ...base, now: now + 240_000 }).ok).toBe(true)
  })

  it('rejects a non-numeric timestamp instead of throwing', () => {
    expect(verify({ ...base, timestamp: 'not-a-number' })).toEqual({
      ok: false,
      reason: 'bad_timestamp',
    })
  })

  /** During a secret rotation both signatures travel in one header. */
  it('accepts when one of several space-separated signatures matches', () => {
    const other = sign(generateSecret(), base.id, Number(base.timestamp), BODY)
    expect(verify({ ...base, signature: `${other} ${base.signature}` }).ok).toBe(true)
  })
})

describe('secrets', () => {
  it('generates a recognisable, unique secret', () => {
    const secrets = new Set(Array.from({ length: 100 }, () => generateSecret()))
    expect(secrets.size).toBe(100)
    for (const secret of secrets) expect(secret.startsWith('whsec_')).toBe(true)
  })
})
