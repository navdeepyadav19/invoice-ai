import { describe, expect, it, vi } from 'vitest'

import { generateDeviceCode, hashDeviceCode } from './device'
import {
  handleDeviceRequest,
  handleTokenRequest,
  type DeviceStore,
  type HandlerDeps,
  type OwnerSession,
  type PollResult,
} from './handlers'

/**
 * Route-level tests for /api/cli/device and /api/cli/token with an in-memory
 * store. The single-use guarantee itself lives in SQL (a row lock in
 * cli_device_poll); these check that the HTTP layer honours what the store
 * says and never mints without an `approved` outcome.
 */

const SITE = 'https://invoice.example'

function post(path: string, body: unknown, ip = '203.0.113.9'): Request {
  return new Request(`${SITE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function owner(overrides: Partial<OwnerSession> = {}): OwnerSession {
  return {
    createKey: vi.fn(async () => ({ ok: true as const, id: 'key-1', plaintext: 'inv_live_abc_secret' })),
    attachKey: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
    account: vi.fn(async () => ({ email: 'me@example.com', business_name: 'QA Studio' })),
    ...overrides,
  }
}

function deps(store: Partial<DeviceStore> = {}, extra: Partial<HandlerDeps> = {}): HandlerDeps {
  return {
    store: {
      start: vi.fn(async () => 'created' as const),
      poll: vi.fn(async (): Promise<PollResult> => ({
        outcome: 'authorization_pending',
        ownerId: null,
        scopes: null,
        clientName: null,
      })),
      asOwner: vi.fn(async () => owner()),
      ...store,
    },
    rateLimit: vi.fn(async () => ({ ok: true, retryAfter: 0 })),
    siteUrl: SITE,
    ready: () => true,
    ...extra,
  }
}

describe('POST /api/cli/device', () => {
  it('returns the RFC 8628 device authorization response', async () => {
    const d = deps()
    const res = await handleDeviceRequest(post('/api/cli/device', { client_name: 'mbp', client_os: 'darwin' }), d)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')

    const body = await res.json()
    expect(body.device_code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.user_code).toMatch(/^[BCDFGHJKLMNPQRSTVWXZ2-9]{4}-[BCDFGHJKLMNPQRSTVWXZ2-9]{4}$/)
    expect(body.verification_uri).toBe(`${SITE}/cli/authorize`)
    expect(body.verification_uri_complete).toBe(`${SITE}/cli/authorize?code=${body.user_code}`)
    expect(body.interval).toBe(5)
    expect(body.expires_in).toBe(600)

    // Only the hash and the dash-free code reach the store.
    expect(d.store.start).toHaveBeenCalledWith({
      deviceCodeHash: hashDeviceCode(body.device_code),
      userCode: body.user_code.replace('-', ''),
      clientName: 'mbp',
      clientOs: 'darwin',
    })
  })

  it('accepts an empty body', async () => {
    const d = deps()
    const res = await handleDeviceRequest(post('/api/cli/device', ''), d)
    expect(res.status).toBe(200)
    expect(d.store.start).toHaveBeenCalledWith(expect.objectContaining({ clientName: 'Unknown device', clientOs: null }))
  })

  it('retries with a new user code on collision', async () => {
    const start = vi
      .fn<DeviceStore['start']>()
      .mockResolvedValueOnce('collision')
      .mockResolvedValueOnce('created')
    const res = await handleDeviceRequest(post('/api/cli/device', {}), deps({ start }))
    expect(res.status).toBe(200)
    expect(start).toHaveBeenCalledTimes(2)
    expect(start.mock.calls[0][0].userCode).not.toBe(start.mock.calls[1][0].userCode)
  })

  it('is rate-limited per IP', async () => {
    const rateLimit = vi.fn(async () => ({ ok: false, retryAfter: 42 }))
    const d = deps({}, { rateLimit })
    const res = await handleDeviceRequest(post('/api/cli/device', {}, '198.51.100.1, 10.0.0.1'), d)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('42')
    expect((await res.json()).error).toBe('rate_limited')
    expect(rateLimit).toHaveBeenCalledWith('198.51.100.1', 'cli-device', { limit: 10, windowSeconds: 60 })
    expect(d.store.start).not.toHaveBeenCalled()
  })

  it('rejects a non-object body', async () => {
    const res = await handleDeviceRequest(post('/api/cli/device', '[1,2]'), deps())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('refuses to start when API keys are not configured', async () => {
    const d = deps({}, { ready: () => false })
    const res = await handleDeviceRequest(post('/api/cli/device', {}), d)
    expect(res.status).toBe(500)
    expect(d.store.start).not.toHaveBeenCalled()
  })
})

describe('POST /api/cli/token', () => {
  const deviceCode = generateDeviceCode()

  it.each([
    'authorization_pending',
    'slow_down',
    'access_denied',
    'expired_token',
    'invalid_grant',
  ] as const)('passes %s through as a 400', async (outcome) => {
    const poll = vi.fn(async () => ({ outcome, ownerId: null, scopes: null, clientName: null }))
    const d = deps({ poll })
    const res = await handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), d)
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: outcome })
    expect(poll).toHaveBeenCalledWith(hashDeviceCode(deviceCode))
    expect(d.store.asOwner).not.toHaveBeenCalled()
  })

  it('400 invalid_request without a device_code', async () => {
    const res = await handleTokenRequest(post('/api/cli/token', {}), deps())
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('invalid_request')
  })

  it('treats a malformed device_code as invalid_grant without a lookup', async () => {
    const d = deps()
    const res = await handleTokenRequest(post('/api/cli/token', { device_code: 'nope' }), d)
    expect((await res.json()).error).toBe('invalid_grant')
    expect(d.store.poll).not.toHaveBeenCalled()
  })

  it('mints the key as the owner on approval and returns it once', async () => {
    const session = owner()
    const poll = vi.fn(async (): Promise<PollResult> => ({
      outcome: 'approved',
      ownerId: 'user-1',
      scopes: ['invoices:read', 'not-a-scope', 'clients:read'],
      clientName: 'navdeep-mbp',
    }))
    const asOwner = vi.fn(async () => session)

    const res = await handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), deps({ poll, asOwner }))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({
      api_key: 'inv_live_abc_secret',
      key_id: 'key-1',
      scopes: ['invoices:read', 'clients:read'],
      account: { email: 'me@example.com', business_name: 'QA Studio' },
    })

    expect(asOwner).toHaveBeenCalledWith('user-1')
    expect(session.createKey).toHaveBeenCalledWith({
      name: 'CLI · navdeep-mbp',
      scopes: ['invoices:read', 'clients:read'],
    })
    expect(session.attachKey).toHaveBeenCalledWith(hashDeviceCode(deviceCode), 'key-1')
    expect(session.release).not.toHaveBeenCalled()
  })

  it('a second poll after consumption gets invalid_grant, never a second key', async () => {
    // Model the SQL row lock: the first poll flips approved → consumed.
    let status: 'approved' | 'consumed' = 'approved'
    const poll = vi.fn(async (): Promise<PollResult> => {
      if (status === 'approved') {
        status = 'consumed'
        return { outcome: 'approved', ownerId: 'user-1', scopes: ['invoices:read'], clientName: 'mbp' }
      }
      return { outcome: 'invalid_grant', ownerId: null, scopes: null, clientName: null }
    })
    const session = owner()
    const d = deps({ poll, asOwner: async () => session })

    const [a, b] = await Promise.all([
      handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), d),
      handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), d),
    ])

    expect([a.status, b.status].sort()).toEqual([200, 400])
    expect(session.createKey).toHaveBeenCalledTimes(1)
  })

  it('releases the claim when the key insert fails, so the next poll can retry', async () => {
    const session = owner({ createKey: vi.fn(async () => ({ ok: false as const, error: 'boom' })) })
    const poll = vi.fn(async (): Promise<PollResult> => ({
      outcome: 'approved',
      ownerId: 'user-1',
      scopes: ['invoices:read'],
      clientName: 'mbp',
    }))

    const res = await handleTokenRequest(
      post('/api/cli/token', { device_code: deviceCode }),
      deps({ poll, asOwner: async () => session }, { log: () => undefined }),
    )
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('server_error')
    expect(session.release).toHaveBeenCalledWith(hashDeviceCode(deviceCode))
    expect(session.attachKey).not.toHaveBeenCalled()
  })

  it('still returns the key if attaching it to the login fails', async () => {
    const session = owner({ attachKey: vi.fn(async () => Promise.reject(new Error('nope'))) })
    const poll = vi.fn(async (): Promise<PollResult> => ({
      outcome: 'approved',
      ownerId: 'user-1',
      scopes: ['invoices:read'],
      clientName: 'mbp',
    }))
    const res = await handleTokenRequest(
      post('/api/cli/token', { device_code: deviceCode }),
      deps({ poll, asOwner: async () => session }, { log: () => undefined }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).api_key).toBe('inv_live_abc_secret')
  })

  it('is rate-limited per IP', async () => {
    const d = deps({}, { rateLimit: async () => ({ ok: false, retryAfter: 7 }) })
    const res = await handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), d)
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBe('7')
    expect(d.store.poll).not.toHaveBeenCalled()
  })

  it('does not consume an approval when the deployment cannot mint keys', async () => {
    const d = deps({}, { ready: () => false })
    const res = await handleTokenRequest(post('/api/cli/token', { device_code: deviceCode }), d)
    expect(res.status).toBe(500)
    expect(d.store.poll).not.toHaveBeenCalled()
  })
})
