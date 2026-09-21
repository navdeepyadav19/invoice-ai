'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/supabase/env'
import { mergePendingGuestData } from '@/lib/actions/claim'
import { friendlyAuthError } from '@/lib/auth-messages'
import { sendVerificationEmail } from '@/lib/email'
import {
  generateVerificationToken,
  hashVerificationToken,
  verificationUrl,
  type CreateVerificationResult,
} from '@/lib/email-verification'
import { echoValues, withValues, type AuthFormState } from '@/lib/form-state'
import { getCurrentUser } from '@/lib/queries'

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
 * "Confirm email" is OFF in Supabase, so signUp() returns a live session and
 * the user goes straight to onboarding. Verification is tracked by the app
 * instead (profiles.email_verified_at, migration 0012): we email our own link
 * and show an "unverified" banner until it's clicked. Sending that email must
 * never block signup — if Resend is down or unconfigured, we log and move on;
 * the banner lets them ask again.
 *
 * If the project still has confirmations ON, signUp() returns no session. We
 * then fall back to the old check-email screen so nothing breaks before the
 * dashboard toggle is flipped.
 *
 * On failure the typed name and email are echoed back (never the password) so
 * React's post-action form reset doesn't wipe them.
 */
export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const values = echoValues(formData)

  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) return { error: firstIssue(parsed.error), values }

  const supabase = await createClient()
  const fullName = String(formData.get('full_name') ?? '').trim()

  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      emailRedirectTo: `${siteUrl()}/auth/callback?next=/onboarding`,
      data: fullName ? { full_name: fullName } : undefined,
    },
  })

  if (error) return { error: friendlyAuthError(error.message), values }

  if (!data.session) {
    redirect(`/signup/check-email?email=${encodeURIComponent(parsed.data.email)}`)
  }

  // Same client that holds the brand-new session in memory — a fresh one would
  // depend on the cookies just written being readable within this request.
  const sent = await issueVerificationEmail(supabase, parsed.data.email, fullName || null)
  if (sent !== 'created') {
    console.error(`[signup] verification email not sent for new user: ${sent}`)
  }

  redirect('/onboarding')
}

type IssueResult = CreateVerificationResult | 'failed'
type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>

/**
 * Mints a verification token for the signed-in user and emails the link.
 *
 * Only the SHA-256 of the token reaches the database; the raw token goes into
 * the email and nowhere else. The 60-second rate limit lives in the database
 * function so two tabs can't race past it. Never throws.
 */
async function issueVerificationEmail(
  supabase: SupabaseServerClient,
  email: string,
  name: string | null,
): Promise<IssueResult> {
  try {
    const token = generateVerificationToken()

    const { data: status, error } = await supabase.rpc('create_email_verification', {
      p_token_hash: hashVerificationToken(token),
    })

    if (error) {
      console.error('[verify-email] could not create token', error.message)
      return 'failed'
    }
    if (status !== 'created') return status

    await sendVerificationEmail({ to: email, name, verifyUrl: verificationUrl(siteUrl(), token) })
    return 'created'
  } catch (err) {
    console.error('[verify-email] send failed', err instanceof Error ? err.message : err)
    return 'failed'
  }
}

/** The "Resend verification email" button in the unverified banner. */
// Takes no arguments: useActionState passes (prevState, formData), and a
// function that ignores both is still assignable to that signature.
export async function resendVerificationEmailAction(): Promise<AuthFormState> {
  const user = await getCurrentUser()
  if (!user || user.is_anonymous || !user.email) {
    return { error: 'Sign in with an email address first.' }
  }

  const name = typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null

  const supabase = await createClient()

  switch (await issueVerificationEmail(supabase, user.email, name)) {
    case 'created':
      return { message: `Sent to ${user.email}. The link works for 24 hours.` }
    case 'rate_limited':
      return { error: 'We just sent one — wait a minute before asking again.' }
    case 'already_verified':
      return { message: 'Your email is already verified.' }
    case 'no_email':
      return { error: 'Add an email address to your account first.' }
    case 'failed':
      return { error: 'We couldn’t send the email just now. Try again in a few minutes.' }
  }
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  const values = echoValues(formData)

  if (!parsed.success) return { error: firstIssue(parsed.error), values }

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword(parsed.data)

  if (error) {
    // Supabase deliberately returns the same message for a wrong password and an
    // unknown email so the endpoint can't be used to enumerate accounts. The
    // friendly rewrite keeps that property — one message for both.
    return { error: friendlyAuthError(error.message), values }
  }

  // If this sign-in was the second half of a guest upgrade that hit an existing
  // email, move the guest's invoices across now that we're authenticated as the
  // account that will own them.
  await mergePendingGuestData()

  const next = String(formData.get('next') ?? '/dashboard')
  // '//evil.com' also starts with '/', and browsers treat it as another host.
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard')
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
  if (!email.success) return withValues({ error: 'Enter a valid email address' }, formData)

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${siteUrl()}/auth/callback?next=/reset-password`,
  })

  if (error) return withValues({ error: friendlyAuthError(error.message) }, formData)

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
