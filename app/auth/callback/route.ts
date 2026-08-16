import { NextResponse, type NextRequest } from 'next/server'
import type { EmailOtpType } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'

/**
 * Where every email link and OAuth redirect lands.
 *
 * Supabase sends two shapes depending on the flow and on how old the project's
 * email templates are:
 *   - PKCE / OAuth      -> ?code=...
 *   - email confirmation -> ?token_hash=...&type=signup|recovery|magiclink
 * Handling both means neither an OAuth login nor an emailed confirmation link
 * dead-ends, which is otherwise a confusing failure to diagnose.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl

  const code = searchParams.get('code')
  const tokenHash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null

  // Only ever redirect to a path on this origin — an open redirect here would
  // let someone email a "confirm your account" link that lands on their site.
  const rawNext = searchParams.get('next') ?? '/dashboard'
  const next = rawNext.startsWith('/') ? rawNext : '/dashboard'

  const supabase = await createClient()

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    return failure(origin, error.message)
  }

  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
    if (!error) return NextResponse.redirect(`${origin}${next}`)
    return failure(origin, error.message)
  }

  return failure(origin, 'That link is invalid or has already been used.')
}

function failure(origin: string, message: string) {
  return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(message)}`)
}
