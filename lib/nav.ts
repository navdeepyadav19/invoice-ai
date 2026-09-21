/**
 * Active-state rules for the app sidebar, kept free of React so they can be
 * unit tested.
 *
 * Matching is by path segment, not raw string prefix: /products/abc lights up
 * Products, but /productsfoo does not, and /settings does not light up
 * /settings/business.
 */

export type NavMatchable = {
  href: string
  /**
   * Path prefixes that count as "inside" this item. Defaults to [href]. Lets an
   * item link somewhere other than where it is considered active — Invoices
   * links to the list on /dashboard but owns everything under /invoices.
   */
  match?: readonly string[]
}

export function isActivePath(pathname: string, prefix: string): boolean {
  if (prefix === '/') return pathname === '/'
  const base = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix
  return pathname === base || pathname.startsWith(`${base}/`)
}

export function isNavItemActive(pathname: string | null, item: NavMatchable): boolean {
  if (!pathname) return false
  return (item.match ?? [item.href]).some((prefix) => isActivePath(pathname, prefix))
}

/** Cookie holding the desktop sidebar's collapsed preference ("1" = collapsed). */
export const SIDEBAR_COLLAPSED_COOKIE = 'sidebar_collapsed'

/** Up to two initials for an avatar, from an email's local part. */
export function initialsFromEmail(email: string | null | undefined): string {
  const local = (email ?? '').split('@')[0] ?? ''
  const parts = local.split(/[._+-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const letters = parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 1)
  return letters.toUpperCase()
}
