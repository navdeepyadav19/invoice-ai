/**
 * Where to send a user after onboarding, when they arrived in the middle of a
 * flow that must resume: an assistant asking for consent (/oauth/authorize) or
 * the CLI asking to sign in (/cli/authorize).
 *
 * A brand-new user on that path goes signup → onboarding (two steps) → … and
 * the `next=` parameter doesn't survive that trip. So the proxy notes the URL
 * in a short-lived cookie whenever one of these flows is opened, and finishing
 * onboarding consumes it. Every other page ignores it.
 */

export const RETURN_TO_COOKIE = 'return_to'
export const RETURN_TO_MAX_AGE_SECONDS = 30 * 60

/** Pages that are part of a flow another app is waiting on. */
export const RESUMABLE_PATHS = ['/oauth/authorize', '/cli/authorize']

export function isResumablePath(pathname: string): boolean {
  return RESUMABLE_PATHS.includes(pathname)
}
