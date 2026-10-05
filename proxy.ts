import { NextResponse, type NextRequest } from 'next/server'

import { getAuth } from '@/lib/auth/server'
import { isResumablePath, RETURN_TO_COOKIE, RETURN_TO_MAX_AGE_SECONDS } from '@/lib/auth/return-to'

/**
 * Next.js 16 renamed Middleware to Proxy. Same execution model, new filename
 * and exported symbol — see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md
 *
 * Two jobs:
 *
 * 1. Send signed-out visitors on app routes to /login?next=<where they were>.
 *    This is an optimistic check only. It stops signed-out users from loading
 *    app shells; it is NOT the authorization boundary. That is RLS (every query
 *    runs as the signed-in user, see lib/db/scoped.ts), plus requireUser() in
 *    each page and action.
 * 2. Finish Google sign-in. Neon Auth sends the browser back to our callbackURL
 *    with ?neon_auth_session_verifier=…, and only its middleware can trade that
 *    for a session cookie — so it must run on that request even though
 *    /auth/callback is otherwise public.
 */

/**
 * Paths reachable without any session at all.
 *
 * `/api/public/` is here for the same reason as `/i/`: it IS the client-facing
 * surface. Leaving it out sent every "Download PDF" click to the login page —
 * the page rendered fine, so the failure only showed up on the download.
 */
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  // Where /auth/verify explains an expired or used link — usually opened on a
  // phone with no session, so it must not bounce to /login.
  '/verify-email',
  '/auth',
  '/i/',
  '/api/public/',
  // Neon Auth's own endpoints (sign-in, sign-up, get-session, OAuth), proxied
  // by app/api/auth/[...path]. They authenticate themselves.
  '/api/auth/',
  // Not "public" — every /api/v1 route authenticates. But it authenticates from
  // an Authorization header, which this proxy knows nothing about, so leaving it
  // out means a perfectly valid API key gets a 307 to /login and the integrator
  // sees an HTML page where they expected JSON. Being exempt here costs nothing:
  // withApi returns 401 problem+json for anything unauthenticated, and RLS is
  // the real boundary either way.
  '/api/v1/',
  // The CLI device flow (/api/cli/device, /token, /session). The first two are
  // unauthenticated by design — the CLI has no credential yet — and /session
  // authenticates with an API key header, same reasoning as /api/v1 above.
  // The browser half, /cli/authorize, is NOT here: it needs a session.
  '/api/cli/',
  // Vercel cron, authenticated by CRON_SECRET in the route itself.
  '/api/cron/',
  // OAuth discovery documents, served unauthenticated by definition.
  '/.well-known/',
  // The MCP server. Like /api/v1, it authenticates from a bearer token in the
  // Authorization header, which this proxy knows nothing about — without this
  // entry an assistant's valid token would get a 307 to an HTML login page
  // instead of the 401 challenge that tells it how to sign in.
  '/mcp',
  // OAuth endpoints an app calls server-to-server, authenticated by the
  // client's own credentials (or PKCE). The consent page, /oauth/authorize,
  // is deliberately NOT here: it needs the user's session, and a signed-out
  // visitor must go through /login?next=… with the full request preserved.
  '/oauth/token',
  '/oauth/register',
  '/oauth/revoke',
]

const SESSION_VERIFIER_PARAM = 'neon_auth_session_verifier'

export function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
}

export async function proxy(request: NextRequest) {
  const { pathname, search, searchParams } = request.nextUrl

  if (isPublicPath(pathname) && !searchParams.has(SESSION_VERIFIER_PARAM)) {
    return NextResponse.next()
  }

  const response = await getAuth().middleware({ loginUrl: '/login' })(request)

  // A flow another app is waiting on: remember it, so a new user who has to
  // sign up and onboard first still ends up back here (lib/auth/return-to.ts).
  if (isResumablePath(pathname)) {
    response.cookies.set(RETURN_TO_COOKIE, pathname + search, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: RETURN_TO_MAX_AGE_SECONDS,
    })
  }

  // Neon's middleware copies the original query onto the login URL. We want
  // the whole destination in `next` instead: /cli/authorize?code=WXYZ-2345
  // must come back with its code after sign-in, or the CLI login dead-ends.
  const location = response.headers.get('location')
  if (location && new URL(location, request.url).pathname === '/login') {
    const loginUrl = new URL('/login', request.url)
    loginUrl.searchParams.set('next', pathname + search)
    response.headers.set('location', loginUrl.toString())
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and image files. Session cookies need
     * refreshing on document requests, not on every .svg.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$).*)',
  ],
}
