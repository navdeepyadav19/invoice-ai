import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

import { supabasePublishableKey, supabaseUrl } from './env'

/** Paths reachable without any session at all. */
const PUBLIC_PREFIXES = ['/login', '/signup', '/forgot-password', '/reset-password', '/auth', '/i/']

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
    redirectUrl.searchParams.set('next', request.nextUrl.pathname)
    return NextResponse.redirect(redirectUrl)
  }

  return response
}
