import { NextResponse, type NextRequest } from 'next/server'

import { anonDb, userDb } from '@/lib/db'
import { redeemEmailVerification } from '@/lib/db/rpc'
import {
  hashVerificationToken,
  isWellFormedToken,
  toRedeemResult,
  type RedeemVerificationResult,
} from '@/lib/email-verification'
import { getCurrentUser } from '@/lib/queries'

/**
 * Where the "Verify your email" link lands.
 *
 * The token in the URL is hashed here and matched against the stored hash by
 * redeem_email_verification(), which is callable without a session — people
 * often open these links on a phone where they aren't signed in. Possession of
 * the token is the proof.
 *
 * Outcomes:
 *   - verified, signed in       -> /dashboard?verified=1 (or /onboarding if not done)
 *   - verified, not signed in   -> /login?verified=1
 *   - anything else             -> /verify-email?status=... (a friendly explainer)
 *
 * Only fixed internal paths are ever redirected to, so there's no `next`
 * parameter for anyone to abuse.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl
  const token = searchParams.get('token')

  if (!isWellFormedToken(token)) return explain(origin, 'invalid')

  let result: RedeemVerificationResult
  try {
    result = toRedeemResult(await redeemEmailVerification(anonDb(), hashVerificationToken(token)))
  } catch (err) {
    console.error('[verify-email] redeem failed', err instanceof Error ? err.message : err)
    return explain(origin, 'invalid')
  }

  if (result !== 'verified' && result !== 'already_verified') return explain(origin, result)

  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(`${origin}/login?verified=1`)

  const profile = await userDb(user.id)
    .selectFrom('profiles')
    .select('onboarding_completed_at')
    .where('id', '=', user.id)
    .executeTakeFirst()

  const destination = profile?.onboarding_completed_at ? '/dashboard' : '/onboarding'
  return NextResponse.redirect(`${origin}${destination}?verified=1`)
}

function explain(origin: string, status: RedeemVerificationResult) {
  return NextResponse.redirect(`${origin}/verify-email?status=${status}`)
}
