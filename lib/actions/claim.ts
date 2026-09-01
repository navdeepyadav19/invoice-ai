'use server'

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/supabase/env'
import { requireUser } from '@/lib/queries'
import { PENDING_MERGE_COOKIE } from '@/lib/form-state'
import type { ClaimState } from '@/lib/claim-state'

const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

/**
 * Turn a guest into a permanent account.
 *
 * The happy path is almost boring, and that's the point: `updateUser` attaches
 * an email and password to the SAME auth user, so the uid never changes and not
 * a single invoice row has to move. Supabase then emails a confirmation link.
 *
 * The interesting case is the collision — the guest types an email that already
 * has an account. We can't merge two auth users, so we park the guest's uid in a
 * short-lived cookie and hand off to sign-in, which re-parents the rows once
 * they're authenticated as the existing account.
 */
export async function claimAccountAction(
  _prev: ClaimState,
  formData: FormData,
): Promise<ClaimState> {
  const user = await requireUser()

  if (!user.is_anonymous) redirect('/dashboard')

  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const supabase = await createClient()

  const { error } = await supabase.auth.updateUser(
    { email: parsed.data.email, password: parsed.data.password },
    { emailRedirectTo: `${siteUrl()}/auth/callback?next=/dashboard` },
  )

  if (error) {
    if (isEmailTakenError(error.message)) {
      // Mint the proof-of-ownership token NOW, while we are still the guest and
      // RLS will let us write a row owned by this uid. After sign-out we could
      // never prove we controlled this session.
      const { data: token, error: tokenError } = await supabase
        .from('merge_tokens')
        .insert({ owner_id: user.id })
        .select('token')
        .single()

      if (tokenError || !token) {
        return { error: `${parsed.data.email} already has an account, and we couldn't prepare a transfer. Try a different email.` }
      }

      const jar = await cookies()
      jar.set(PENDING_MERGE_COOKIE, token.token, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 60 * 30,
        path: '/',
      })

      return {
        conflictEmail: parsed.data.email,
        error: `${parsed.data.email} already has an account.`,
      }
    }

    return { error: error.message }
  }

  // Their business details already exist (they filled them in the builder), so
  // finishing onboarding here means they are never shown the wizard.
  await supabase
    .from('profiles')
    .update({
      email: parsed.data.email,
      onboarding_completed_at: new Date().toISOString(),
      onboarding_step: 3,
    })
    .eq('id', user.id)

  return {
    message: `Check ${parsed.data.email} for a confirmation link. Your invoices are already saved to this account.`,
  }
}

function isEmailTakenError(message: string): boolean {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('already registered') ||
    normalized.includes('already been registered') ||
    normalized.includes('already exists') ||
    normalized.includes('email address is taken')
  )
}

/**
 * Redeems a pending merge token against the account that just signed in.
 *
 * Called from signInAction so it runs exactly once per sign-in rather than on
 * every page render. The token is consumed by the database function, so a replay
 * of the same cookie does nothing.
 *
 * Returns the number of invoices moved, or 0 if there was nothing pending.
 */
export async function mergePendingGuestData(): Promise<number> {
  const jar = await cookies()
  const token = jar.get(PENDING_MERGE_COOKIE)?.value
  if (!token) return 0

  jar.delete(PENDING_MERGE_COOKIE)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('redeem_merge_token', { p_token: token })

  if (error) {
    console.error('Failed to redeem merge token', error)
    return 0
  }

  return data ?? 0
}
