import { describe, expect, it } from 'vitest'

import { assertSafeUrl, deliver, isPrivateAddress, nextAttemptAt, pinnedLookup, RETRY_SCHEDULE_SECONDS } from './deliver'

/**
 * A webhook URL is an arbitrary address a user gives us, which our server then
 * requests from inside our own network. Without these checks that is a
 * server-side request forgery primitive.
 */
describe('SSRF guard', () => {
  it.each([
    ['loopback', '127.0.0.1'],
    ['loopback, unusual form', '127.1.2.3'],
    ['private 10/8', '10.0.0.1'],
    ['private 172.16/12', '172.16.0.1'],
    ['private 172.31/12', '172.31.255.254'],
    ['private 192.168/16', '192.168.1.1'],
    ['cloud metadata', '169.254.169.254'],
    ['this network', '0.0.0.0'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['multicast', '224.0.0.1'],
    ['IPv6 loopback', '::1'],
    ['IPv6 link-local', 'fe80::1'],
    ['IPv6 unique local', 'fd00::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['IPv4-mapped loopback, hex form', '::ffff:7f00:1'],
    ['IPv4-mapped metadata', '::ffff:a9fe:a9fe'],
    ['NAT64 loopback', '64:ff9b::7f00:1'],
    ['6to4 wrapping loopback', '2002:7f00:1::1'],
    ['Teredo', '2001:0:4136:e378:8000:63bf:3fff:fdd2'],
    ['IPv6 link-local beyond fe80', 'febf::1'],
    ['IPv6 site-local', 'fec0::1'],
    ['IPv6 unspecified', '::'],
    ['benchmarking range', '198.18.0.1'],
    ['broadcast', '255.255.255.255'],
    ['not an address at all', 'nonsense'],
  ])('blocks %s', (_label, address) => {
    expect(isPrivateAddress(address)).toBe(true)
  })

  it.each([
    ['a public v4', '93.184.216.34'],
    ['another public v4', '8.8.8.8'],
    ['172.15 is NOT private', '172.15.0.1'],
    ['172.32 is NOT private', '172.32.0.1'],
    ['a public v6', '2606:2800:220:1:248:1893:25c8:1946'],
  ])('allows %s', (_label, address) => {
    expect(isPrivateAddress(address)).toBe(false)
  })

  /**
   * 169.254.169.254 is the cloud metadata endpoint on AWS, GCP and Azure.
   * Reaching it from inside a function is how instance credentials get stolen,
   * so it gets its own test rather than relying on the link-local range.
   */
  it('blocks the cloud metadata endpoint specifically', () => {
    expect(isPrivateAddress('169.254.169.254')).toBe(true)
  })
})

describe('assertSafeUrl', () => {
  it.each([
    ['plain http', 'http://example.com/hook'],
    ['an IPv6 loopback literal', 'https://[::1]/hook'],
    ['an IPv4-mapped literal', 'https://[::ffff:127.0.0.1]/hook'],
    ['the metadata endpoint', 'https://169.254.169.254/latest/meta-data/'],
    ['a decimal-encoded loopback', 'https://2130706433/hook'],
    ['a name that resolves to loopback', 'https://localhost/hook'],
    ['credentials in the URL', 'https://user:pass@93.184.216.34/hook'],
    ['garbage', 'not a url'],
  ])('refuses %s', async (_label, url) => {
    expect((await assertSafeUrl(url)).ok).toBe(false)
  })

  it('accepts a public IP literal without a DNS round trip', async () => {
    expect(await assertSafeUrl('https://93.184.216.34/hook')).toEqual({ ok: true })
  })
})

/**
 * The check at connect time is what defeats DNS rebinding: whatever the name
 * resolves to when the socket opens is checked again, not trusted from earlier.
 */
describe('pinnedLookup', () => {
  it('refuses a name that resolves to a private address', async () => {
    const error = await new Promise<Error | null>((resolve) =>
      pinnedLookup('localhost', {}, (err) => resolve(err)),
    )
    expect(error?.message).toMatch(/public address/)
  })

  it('never reaches a loopback listener, even via deliver()', async () => {
    const result = await deliver('https://localhost:1/hook', 'whsec_test', 'msg_1', { hello: 'world' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/public address/)
  })
})

describe('retry ladder', () => {
  const now = Date.UTC(2026, 8, 17, 12, 0, 0)

  it('backs off along the schedule', () => {
    // attempt is 1-based: the row is incremented when it is claimed.
    expect(nextAttemptAt(1, now)?.toISOString()).toBe(new Date(now + 60_000).toISOString())
    expect(nextAttemptAt(2, now)?.toISOString()).toBe(new Date(now + 300_000).toISOString())
    expect(nextAttemptAt(6, now)?.toISOString()).toBe(new Date(now + 86_400_000).toISOString())
  })

  it('returns null once the ladder is exhausted, which means dead', () => {
    expect(nextAttemptAt(RETRY_SCHEDULE_SECONDS.length + 1, now)).toBeNull()
  })

  it('gives up after roughly a day and a half of trying', () => {
    const total = RETRY_SCHEDULE_SECONDS.reduce((sum, seconds) => sum + seconds, 0)
    expect(total / 3600).toBeGreaterThan(24)
    expect(total / 3600).toBeLessThan(48)
  })

  it('front-loads the first retries, since most failures are brief', () => {
    for (let i = 1; i < RETRY_SCHEDULE_SECONDS.length; i += 1) {
      expect(RETRY_SCHEDULE_SECONDS[i]).toBeGreaterThan(RETRY_SCHEDULE_SECONDS[i - 1])
    }
    expect(RETRY_SCHEDULE_SECONDS[0]).toBeLessThanOrEqual(60)
  })
})
