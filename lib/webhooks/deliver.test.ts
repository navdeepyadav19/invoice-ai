import { describe, expect, it } from 'vitest'

import { isPrivateAddress, nextAttemptAt, RETRY_SCHEDULE_SECONDS } from './deliver'

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
