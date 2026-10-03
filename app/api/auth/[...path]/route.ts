import type { NeonAuth } from '@neondatabase/auth/next/server'

import { getAuth } from '@/lib/auth/server'

/**
 * Neon Auth's endpoints (sign-in, sign-up, get-session, OAuth callbacks…),
 * proxied through our origin so the session cookies are first-party.
 *
 * The handler is looked up per request rather than at import: building it
 * reads NEON_AUTH_* and `next build` imports every route without them.
 */
type Method = keyof ReturnType<NeonAuth['handler']>

const delegate =
  (method: Method) =>
  (request: Request, context: { params: Promise<{ path: string[] }> }) =>
    getAuth().handler()[method](request, context)

export const GET = delegate('GET')
export const POST = delegate('POST')
export const PUT = delegate('PUT')
export const DELETE = delegate('DELETE')
export const PATCH = delegate('PATCH')
