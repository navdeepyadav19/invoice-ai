/**
 * Where an authorization server may send the browser back to — the single
 * most security-sensitive check in OAuth. A loose rule here hands an
 * attacker the authorization code.
 *
 * Allowed at registration:
 *   https://…                 any https URL (web apps: Claude.ai, ChatGPT)
 *   http://127.0.0.1:…/…      loopback, for apps on the user's machine
 *   http://[::1]:…/…          (RFC 8252 §7.3)
 *   http://localhost:…/…
 *   com.example.app:/cb       a private-use scheme in reverse-DNS form, for
 *                             native apps (RFC 8252 §7.1) — never javascript:,
 *                             data:, file: and friends
 * Never a fragment, never a user:password@ part.
 *
 * Matching at authorize time is exact string comparison, with one exception
 * from RFC 8252 §7.3: on loopback the port may differ, because a native app
 * picks a free port at runtime.
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]', 'localhost'])
const PRIVATE_SCHEME = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+$/
const FORBIDDEN_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript', 'about', 'blob'])

export function isValidRedirectUri(raw: string): boolean {
  if (typeof raw !== 'string' || raw.length > 2048) return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.hash || url.username || url.password || raw.includes('#')) return false

  const scheme = url.protocol.slice(0, -1)
  if (scheme === 'https') return Boolean(url.hostname)
  if (scheme === 'http') return LOOPBACK_HOSTS.has(url.hostname)
  return PRIVATE_SCHEME.test(scheme) && !FORBIDDEN_SCHEMES.has(scheme)
}

export function matchRedirectUri(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true

  const asked = parseLoopback(requested)
  if (!asked) return false

  // Same scheme, host, path and query — only the port may differ.
  return registered.some((candidate) => {
    const allowed = parseLoopback(candidate)
    return allowed !== null && allowed.host === asked.host && allowed.rest === asked.rest
  })
}

/** Shown on the consent screen: where the code will go. */
export function redirectHost(raw: string): string {
  try {
    const url = new URL(raw)
    return url.host || `${url.protocol}…`
  } catch {
    return raw
  }
}

function parseLoopback(raw: string): { host: string; rest: string } | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' || !LOOPBACK_HOSTS.has(url.hostname)) return null
    return { host: url.hostname, rest: `${url.pathname}${url.search}` }
  } catch {
    return null
  }
}
