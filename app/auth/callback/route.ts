import { NextResponse, type NextRequest } from 'next/server'

import { userDb } from '@/lib/db'
import { syncOauthEmailVerification } from '@/lib/db/rpc'
import { ensureProfile, getCurrentUser } from '@/lib/queries'
import { safeNextPath } from '@/lib/safe-redirect'

/**
 * Where Google sign-in lands.
 *
 * Neon Auth sends the browser back here with ?neon_auth_session_verifier=…;
 * proxy.ts trades that for a session cookie and redirects to this same URL
 * without it. So by the time this handler runs there is either a session, or
 * the sign-in failed (Better Auth adds ?error=… when it uses this URL as the
 * error callback, e.g. a cancelled consent screen).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  // Only ever redirect to a path on this origin — an open redirect here would
  // let someone craft a sign-in link that lands on their site.
  const next = safeNextPath(searchParams.get('next'), '/dashboard')

  const oauthError = searchParams.get('error')
  if (oauthError) {
    console.error('[auth/callback] oauth error', oauthError, searchParams.get('error_description'))
    return failure(origin, 'Google sign-in didn’t complete. Try again.')
  }

  const user = await getCurrentUser()
  if (!user) return failure(origin, 'We couldn’t sign you in with Google. Try again.')

  // A first Google sign-in is a brand-new user with no profile row yet.
  try {
    await ensureProfile(user)
  } catch (err) {
    // getProfile() self-heals on the next read; never block login on this.
    console.error('[auth/callback] could not create profile', err instanceof Error ? err.message : err)
  }

  // Google has already verified the address, so a Google sign-in counts as a
  // verified email in our own tracking (profiles.email_verified_at). The
  // function checks Neon Auth's account records itself — it trusts nothing we
  // pass — and is a no-op for any other provider. A failure must never block
  // login.
  try {
    await syncOauthEmailVerification(userDb(user.id))
  } catch (err) {
    console.error('[auth/callback] oauth verification sync failed', err instanceof Error ? err.message : err)
  }

  return NextResponse.redirect(`${origin}${next}`)
}

function failure(origin: string, message: string) {
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`)
}
