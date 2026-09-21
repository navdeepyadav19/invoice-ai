import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

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
 * So: https only, resolve the hostname ourselves, refuse private and
 * link-local addresses, and never follow a redirect (a permitted public host
 * can 302 straight to 127.0.0.1 and bypass a naive check).
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

export async function deliver(
  url: string,
  secret: string,
  deliveryId: string,
  payload: unknown,
): Promise<DeliveryResult> {
  const guard = await assertSafeUrl(url)
  if (!guard.ok) return { ok: false, error: guard.reason }

  const body = JSON.stringify(payload)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: signatureHeaders(secret, deliveryId, body),
      body,
      // A public host that redirects to 127.0.0.1 would defeat the DNS check
      // above, so redirects are refused outright rather than re-validated.
      redirect: 'manual',
      signal: controller.signal,
    })

    if (response.status >= 300 && response.status < 400) {
      return { ok: false, status: response.status, error: 'Redirects are not followed.' }
    }

    // Anything 2xx is success. A subscriber returning 200 with an error body is
    // telling us it accepted the event; that is their contract to keep.
    if (response.status >= 200 && response.status < 300) {
      return { ok: true, status: response.status }
    }

    // Read a little of the body for the error log, and no more — an error page
    // can be a megabyte of HTML.
    const text = await response.text().catch(() => '')
    return { ok: false, status: response.status, error: text.slice(0, 500) }
  } catch (cause) {
    const message =
      cause instanceof Error && cause.name === 'AbortError'
        ? `No response within ${TIMEOUT_MS / 1000}s.`
        : cause instanceof Error
          ? cause.message
          : 'Request failed.'

    return { ok: false, error: message }
  } finally {
    clearTimeout(timer)
  }
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

  // Resolve ourselves rather than trusting the hostname's appearance:
  // `internal.example.com` can resolve to 10.0.0.1 and looks perfectly public.
  const addresses = isIP(url.hostname)
    ? [url.hostname]
    : await resolveAll(url.hostname)

  if (!addresses.length) {
    return { ok: false, reason: `Could not resolve ${url.hostname}.` }
  }

  for (const address of addresses) {
    if (isPrivateAddress(address)) {
      return { ok: false, reason: 'Webhook URLs must point at a public address.' }
    }
  }

  return { ok: true }
}

async function resolveAll(hostname: string): Promise<string[]> {
  try {
    const records = await lookup(hostname, { all: true })
    return records.map((record) => record.address)
  } catch {
    return []
  }
}

/**
 * Private, loopback, link-local and other reserved ranges.
 *
 * 169.254.169.254 is the one that matters most: it is the cloud metadata
 * endpoint on AWS, GCP and Azure, and reaching it from inside a function is how
 * instance credentials get stolen. It falls inside the link-local /16 below.
 */
export function isPrivateAddress(address: string): boolean {
  const version = isIP(address)

  if (version === 4) {
    const parts = address.split('.').map(Number)
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true

    const [a, b] = parts

    if (a === 0) return true // "this network"
    if (a === 10) return true // private
    if (a === 127) return true // loopback
    if (a === 169 && b === 254) return true // link-local, incl. cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true // private
    if (a === 192 && b === 168) return true // private
    if (a === 100 && b >= 64 && b <= 127) return true // carrier-grade NAT
    if (a === 192 && b === 0) return true // IETF protocol assignments
    if (a >= 224) return true // multicast and reserved

    return false
  }

  if (version === 6) {
    const normalised = address.toLowerCase()

    if (normalised === '::1' || normalised === '::') return true
    if (normalised.startsWith('fe80')) return true // link-local
    if (normalised.startsWith('fc') || normalised.startsWith('fd')) return true // unique local
    if (normalised.startsWith('ff')) return true // multicast

    // IPv4-mapped (::ffff:127.0.0.1) would otherwise sail straight through.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalised)
    if (mapped) return isPrivateAddress(mapped[1])

    return false
  }

  // Unparseable: refuse. Failing closed is the only safe default here.
  return true
}
