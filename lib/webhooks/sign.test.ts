import { createHmac } from 'node:crypto'

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

describe('secret encodings', () => {
  // 24 bytes whose encodings differ between the two alphabets (+ and / vs - and _).
  const bytes = Buffer.from('fbfffe3ff00fbef3e7fbfff7e7dfcfbfaf9f8f7f6f5f4f3f', 'hex')
  const base64 = `whsec_${bytes.toString('base64')}`
  const base64url = `whsec_${bytes.toString('base64url')}`

  it('the two encodings really differ', () => {
    expect(base64).not.toBe(base64url)
  })

  it('new secrets are standard base64, as Standard Webhooks specifies', () => {
    for (let i = 0; i < 50; i++) {
      const encoded = generateSecret().slice('whsec_'.length)
      expect(encoded).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
      expect(Buffer.from(encoded, 'base64')).toHaveLength(24)
    }
  })

  it('a base64 secret and its base64url twin produce the same signature', () => {
    expect(sign(base64, ID, 1789371234, BODY)).toBe(sign(base64url, ID, 1789371234, BODY))
  })

  it('an endpoint created with a base64url secret keeps verifying', () => {
    const now = Date.now()
    const headers = signatureHeaders(base64url, ID, BODY, now)
    const input = {
      id: headers['webhook-id'],
      timestamp: headers['webhook-timestamp'],
      signature: headers['webhook-signature'],
      body: BODY,
      now,
    }
    expect(verify({ ...input, secret: base64url }).ok).toBe(true)
    expect(verify({ ...input, secret: base64 }).ok).toBe(true)
  })

  /** A fixed vector, so a change to the decoding can't pass by accident. */
  it('matches an independently computed HMAC', () => {
    const encoded = 'MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw'
    const expected = createHmac('sha256', Buffer.from(encoded, 'base64'))
      .update('msg_p5jXN8AQM9LWM0D4loKWxJek.1614265330.{"test": 2432232314}')
      .digest('base64')
    expect(sign(`whsec_${encoded}`, 'msg_p5jXN8AQM9LWM0D4loKWxJek', 1614265330, '{"test": 2432232314}')).toBe(
      `v1,${expected}`,
    )
  })
})
