import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import {
  hashVerificationToken,
  isWellFormedToken,
  toRedeemResult,
  type RedeemVerificationResult,
} from '@/lib/email-verification'

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

  const supabase = await createClient()

  const { data, error } = await supabase.rpc('redeem_email_verification', {
    p_token_hash: hashVerificationToken(token),
  })

  if (error) {
    console.error('[verify-email] redeem failed', error.message)
    return explain(origin, 'invalid')
  }

  const result = toRedeemResult(data)
  if (result !== 'verified' && result !== 'already_verified') return explain(origin, result)

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user || user.is_anonymous) {
    return NextResponse.redirect(`${origin}/login?verified=1`)
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle()

  const destination = profile?.onboarding_completed_at ? '/dashboard' : '/onboarding'
  return NextResponse.redirect(`${origin}${destination}?verified=1`)
}

function explain(origin: string, status: RedeemVerificationResult) {
  return NextResponse.redirect(`${origin}/verify-email?status=${status}`)
}
