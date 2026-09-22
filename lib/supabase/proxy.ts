import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { supabasePublishableKey, supabaseUrl } from './env'

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
  // OAuth discovery documents, served unauthenticated by definition.
  '/.well-known/',
]

function isPublicPath(pathname: string): boolean {
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix))
}

/**
 * Refreshes the Supabase session on every request and redirects signed-out
 * users away from app routes.
 *
 * Two details matter here:
 *
 * 1. The response object must be the one the cookies were written to. Creating a
 *    fresh NextResponse after setAll runs would drop the refreshed tokens, and
 *    the user would be silently signed out an hour later.
 * 2. This is an optimistic check only. It stops signed-out users from loading
 *    app shells; it is NOT the authorization boundary. That is RLS, plus the
 *    getUser() call in each page and action.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Triggers the refresh. Must complete before the response is committed.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const redirectUrl = request.nextUrl.clone()
    redirectUrl.pathname = '/login'
    // Keep the query string in `next`: /cli/authorize?code=WXYZ-2345 must come
    // back with its code after sign-in, or the CLI login dead-ends.
    redirectUrl.search = ''
    redirectUrl.searchParams.set('next', request.nextUrl.pathname + request.nextUrl.search)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
