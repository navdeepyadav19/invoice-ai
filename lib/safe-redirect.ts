/**
 * The `next=` destination after sign-in, reduced to a path on this origin.
 *
 * "Starts with / but not //" is not enough. Browsers (and the WHATWG URL parser
 * Next's client router uses) treat a backslash as a slash in http(s) URLs, so
 * `/\evil.com` becomes `//evil.com` — a protocol-relative link to someone
 * else's site. Tabs and newlines are stripped by the same parser, so `/\t/evil.com`
 * collapses the same way. Rather than enumerate tricks, resolve the value
 * against a throwaway origin and accept it only if it is still on that origin.
 *
 * Returns the normalised path + query + hash, or `fallback`.
 */
export function safeNextPath(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback
  // Backslashes and control characters have no business in one of our paths.
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback

  const base = 'https://invoice-ai.invalid'
  let url: URL
  try {
    url = new URL(raw, base)
  } catch {
    return fallback
  }
  if (url.origin !== base) return fallback

  const path = `${url.pathname}${url.search}${url.hash}`
  // Belt and braces: a normalised path that still opens with // is a
  // protocol-relative URL once it leaves this function.
  return path.startsWith('//') ? fallback : path
}
