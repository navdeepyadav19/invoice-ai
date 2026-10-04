import { lookup as dnsLookup, type LookupAddress } from 'node:dns'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'

import { signatureHeaders } from '@/lib/webhooks/sign'

/**
 * Deliver one webhook, safely.
 *
 * "Safely" is doing more work here than it looks. A webhook URL is an arbitrary
 * address supplied by a user, and our server will make a request to it from
 * inside our own network — which is a server-side request forgery primitive
 * handed over on a plate. Without the guard below, an attacker registers
 * `http://169.254.169.254/latest/meta-data/iam/…` and we fetch cloud
 * credentials for them and helpfully store the response.
 *
 * So: https only, refuse private and link-local addresses, and never follow a
 * redirect (a permitted public host can 302 straight to 127.0.0.1 and bypass a
 * naive check).
 *
 * The address check runs at CONNECT time, inside the socket's own DNS lookup
 * (pinnedLookup below), not just once beforehand. Checking a name and then
 * letting fetch() resolve it again is a time-of-check/time-of-use gap: a
 * hostile DNS server answers 1.2.3.4 to the check and 127.0.0.1 to the fetch
 * (DNS rebinding). Resolving once and connecting to exactly what was checked
 * closes it.
 */

/** How long we wait before giving up on a subscriber. */
const TIMEOUT_MS = 10_000

/**
 * 1m, 5m, 30m, 2h, 8h, 24h — then dead.
 *
 * Front-loaded because most failures are a deploy or a brief outage and clear
 * within minutes; the long tail exists so an endpoint down overnight still
 * receives yesterday's events.
 */
export const RETRY_SCHEDULE_SECONDS = [60, 300, 1_800, 7_200, 28_800, 86_400]

export function nextAttemptAt(attempt: number, now = Date.now()): Date | null {
  // `attempt` is 1-based: the row is incremented when claimed.
  const delay = RETRY_SCHEDULE_SECONDS[attempt - 1]
  if (delay === undefined) return null
  return new Date(now + delay * 1000)
}

export interface DeliveryResult {
  ok: boolean
  status?: number
  error?: string
}

/** How much of an error response we keep for the delivery log. */
const MAX_ERROR_BODY_BYTES = 500

export async function deliver(
  url: string,
  secret: string,
  deliveryId: string,
  payload: unknown,
): Promise<DeliveryResult> {
  const guard = await assertSafeUrl(url)
  if (!guard.ok) return { ok: false, error: guard.reason }

  const body = JSON.stringify(payload)

  return new Promise<DeliveryResult>((resolve) => {
    let settled = false
    const done = (result: DeliveryResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const request = httpsRequest(
      url,
      {
        method: 'POST',
        headers: {
          ...signatureHeaders(secret, deliveryId, body),
          'content-length': String(Buffer.byteLength(body)),
        },
        // Every name lookup for this socket goes through the address check,
        // so what we connect to is what we validated. https.request never
        // follows redirects, which is the other half of the guard.
        lookup: pinnedLookup,
        // A fresh socket per delivery: a pooled keep-alive connection would
        // skip the lookup, and with it the check.
        agent: false,
      },
      (response) => {
        const status = response.statusCode ?? 0

        if (status >= 300 && status < 400) {
          response.destroy()
          return done({ ok: false, status, error: 'Redirects are not followed.' })
        }

        // Anything 2xx is success. A subscriber returning 200 with an error
        // body is telling us it accepted the event; that is their contract to
        // keep. The body is never read — it can be arbitrarily large.
        if (status >= 200 && status < 300) {
          response.destroy()
          return done({ ok: true, status })
        }

        // Keep a little of the body for the error log, and no more — an error
        // page can be a megabyte of HTML, or an endless stream.
        const chunks: Buffer[] = []
        let size = 0
        const finish = () =>
          done({ ok: false, status, error: Buffer.concat(chunks).toString('utf8').slice(0, MAX_ERROR_BODY_BYTES) })

        response.on('data', (chunk: Buffer) => {
          chunks.push(chunk)
          size += chunk.length
          if (size >= MAX_ERROR_BODY_BYTES) {
            response.destroy()
            finish()
          }
        })
        response.on('end', finish)
        response.on('error', finish)
      },
    )

    const timer = setTimeout(() => {
      request.destroy()
      done({ ok: false, error: `No response within ${TIMEOUT_MS / 1000}s.` })
    }, TIMEOUT_MS)

    request.on('error', (cause) => done({ ok: false, error: cause.message || 'Request failed.' }))
    request.end(body)
  })
}

// ---------------------------------------------------------------------------

export async function assertSafeUrl(raw: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'Not a valid URL.' }
  }

  if (url.protocol !== 'https:') {
    return { ok: false, reason: 'Webhook URLs must use https.' }
  }

  // Credentials in the URL would be sent to the subscriber on every delivery
  // and shown in the dashboard; there is a signing secret for authentication.
  if (url.username || url.password) {
    return { ok: false, reason: 'Webhook URLs must not contain a username or password.' }
  }

  // Resolve ourselves rather than trusting the hostname's appearance:
  // `internal.example.com` can resolve to 10.0.0.1 and looks perfectly public.
  const host = hostOf(url)
  const addresses = isIP(host) ? [host] : await resolveAll(host)

  if (!addresses.length) {
    return { ok: false, reason: `Could not resolve ${host}.` }
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: 'Webhook URLs must point at a public address.' }
    }
  }

  return { ok: true }
}

/** URL.hostname keeps the brackets on an IPv6 literal; isIP() wants them off. */
function hostOf(url: URL): string {
  return url.hostname.replace(/^\[(.*)\]$/, '$1')
}

function resolveAll(hostname: string): Promise<string[]> {
  return new Promise((resolve) => {
    dnsLookup(hostname, { all: true }, (error, records) => {
      resolve(error ? [] : records.map((record) => record.address))
    })
  })
}

/**
 * A drop-in for dns.lookup that refuses to hand a private address to the
 * socket. If ANY address the name resolves to is private the whole lookup
 * fails: a name that is half public, half 127.0.0.1 is a rebinding setup, not
 * a misconfiguration worth working around.
 */
export const pinnedLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, records: LookupAddress[]) => {
    if (error) return callback(error, '', 0)

    if (!records.length || records.some((record) => isPrivateAddress(record.address))) {
      const refused = Object.assign(new Error('Webhook URLs must point at a public address.'), {
        code: 'EADDRNOTAVAIL',
      })
      return callback(refused, '', 0)
    }

    if (options.all) {
      ;(callback as unknown as (err: null, addresses: LookupAddress[]) => void)(null, records)
    } else {
      callback(null, records[0].address, records[0].family)
    }
  })
}

/**
 * Everything that is not the public internet.
 *
 * 169.254.169.254 is the one that matters most: it is the cloud metadata
 * endpoint on AWS, GCP and Azure, and reaching it from inside a function is how
 * instance credentials get stolen. It falls inside the link-local /16 below.
 *
 * IPv6 includes the prefixes that embed an IPv4 address (mapped, NAT64, 6to4,
 * Teredo): each is a way to spell 127.0.0.1 that a v4-only check never sees.
 * Those are refused outright — no legitimate webhook receiver needs one.
 */
const BLOCKED_V4 = new BlockList()
// A separate list for v6: BlockList matches IPv4 queries against v6 rules via
// the ::ffff:0:0/96 mapping, so one shared list would block every v4 address.
const BLOCKED_V6 = new BlockList()

{
  const v4: [string, number][] = [
    ['0.0.0.0', 8], // "this network"
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback
    ['169.254.0.0', 16], // link-local, incl. cloud metadata
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // TEST-NET-1
    ['192.88.99.0', 24], // 6to4 relay anycast
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // TEST-NET-2
    ['203.0.113.0', 24], // TEST-NET-3
    ['224.0.0.0', 3], // multicast, reserved and broadcast
  ]
  for (const [net, prefix] of v4) BLOCKED_V4.addSubnet(net, prefix, 'ipv4')

  const v6: [string, number][] = [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['::', 96], // IPv4-compatible (deprecated)
    ['::ffff:0:0', 96], // IPv4-mapped
    ['64:ff9b::', 96], // NAT64
    ['64:ff9b:1::', 48], // local-use NAT64
    ['100::', 64], // discard-only
    ['2001::', 32], // Teredo
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['fec0::', 10], // site-local (deprecated)
    ['ff00::', 8], // multicast
  ]
  for (const [net, prefix] of v6) BLOCKED_V6.addSubnet(net, prefix, 'ipv6')
}

export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)
  // Unparseable: refuse. Failing closed is the only safe default here.
  if (version === 0) return true
  return version === 4 ? BLOCKED_V4.check(address, 'ipv4') : BLOCKED_V6.check(address, 'ipv6')
}
