'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/supabase/env'
import { mergePendingGuestData } from '@/lib/actions/claim'
import type { AuthFormState } from '@/lib/form-state'

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the details you entered'
}

/**
 * Email + password signup.
 *
 * Email confirmation is ON, so this returns no session — Supabase sends a link
 * and the user lands on /auth/callback when they click it. We redirect to the
 * check-email screen rather than pretending they are signed in.
 */
export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) return { error: firstIssue(parsed.error) }

  const supabase = await createClient()
  const fullName = String(formData.get('full_name') ?? '').trim()

  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/onboarding`,
      data: fullName ? { full_name: fullName } : undefined,
    },
  })

  if (error) return { error: error.message }

  redirect(`/signup/check-email?email=${encodeURIComponent(parsed.data.email)}`)
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) return { error: firstIssue(parsed.error) }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Supabase deliberately returns the same message for a wrong password and an
    // unknown email so the endpoint can't be used to enumerate accounts. Keep it.
    return { error: error.message }
  }

  // If this sign-in was the second half of a guest upgrade that hit an existing
  // email, move the guest's invoices across now that we're authenticated as the
  // account that will own them.
  await mergePendingGuestData()

  const next = String(formData.get('next') ?? '/dashboard')
  redirect(next.startsWith('/') ? next : '/dashboard')
}

/**
 * Guest mode.
 *
 * An anonymous user is a real user: real uid, real JWT, subject to the same RLS
 * as everyone else. That is what lets a guest's invoices survive intact when
 * they later sign up — the uid never changes, so nothing has to be migrated.
 */
export async function continueAsGuestAction(): Promise<void> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInAnonymously()

  if (error) {
    // The usual cause is anonymous sign-ins being switched off in the Supabase
    // dashboard, so say something the user can act on rather than swallowing it.
    redirect(`/login?error=${encodeURIComponent(`Guest mode is unavailable: ${error.message}`)}`)
  }

  redirect('/invoices/new')
}

/** Re-sends the confirmation email. Rate limited by Supabase, not by us. */
export async function resendConfirmationAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = z.email().safeParse(formData.get('email'))
  if (!email.success) return { error: 'Enter a valid email address' }

  const supabase = await createClient()
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.data,
    options: { emailRedirectTo: `${siteUrl()}/auth/callback?next=/onboarding` },
  })

  if (error) return { error: error.message }

  return { message: 'Sent. Check your inbox again in a moment.' }
}

export async function signOutAction(): Promise<never> {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/')
}

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = z.email().safeParse(formData.get('email'))
  if (!email.success) return { error: 'Enter a valid email address' }

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  })

  if (error) return { error: error.message }

  // Deliberately the same response whether or not the address exists.
  return { message: 'If that address has an account, a reset link is on its way.' }
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (password.length < 8) return { error: 'Use at least 8 characters' }
  if (password !== confirm) return { error: 'Those passwords do not match' }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) return { error: error.message }

  redirect('/dashboard')
}

export async function signInWithGoogleAction(formData: FormData): Promise<never> {
  const supabase = await createClient()
  const next = String(formData.get('next') ?? '/dashboard')

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`,
    },
  })

  if (error || !data.url) {
    redirect(`/login?error=${encodeURIComponent(error?.message ?? 'Could not start Google sign-in')}`)
  }

  redirect(data.url)
}
