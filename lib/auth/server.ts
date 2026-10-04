import { createNeonAuth, type NeonAuth } from '@neondatabase/auth/next/server'

/**
 * The Neon Auth (managed Better Auth) server instance.
 *
 * Users, sessions and OAuth links live in the neon_auth schema of our own
 * database; this object talks to the Auth service that manages them. It is
 * created on first use rather than at import so `next build` and CI — which
 * import every route — never need NEON_AUTH_* to be set.
 *
 * Usable from Server Components, Server Actions, Route Handlers and proxy.ts.
 */

let instance: NeonAuth | undefined

export function getAuth(): NeonAuth {
  if (instance) return instance

  const baseUrl = process.env.NEON_AUTH_BASE_URL
  const secret = process.env.NEON_AUTH_COOKIE_SECRET
  if (!baseUrl || !secret) {
    throw new Error(
      'NEON_AUTH_BASE_URL and NEON_AUTH_COOKIE_SECRET must be set. Run `vercel env pull .env.local`.',
    )
  }

  instance = createNeonAuth({ baseUrl, cookies: { secret } })
  return instance
}
