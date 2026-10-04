'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'

import { getAuth } from '@/lib/auth/server'
import { friendlyAuthError } from '@/lib/auth-messages'
import { userDb } from '@/lib/db'
import { createEmailVerification } from '@/lib/db/rpc'
import { sendVerificationEmail } from '@/lib/email'
import {
  generateVerificationToken,
  hashVerificationToken,
  verificationUrl,
  type CreateVerificationResult,
} from '@/lib/email-verification'
import { siteUrl } from '@/lib/env'
import { echoValues, withValues, type AuthFormState } from '@/lib/form-state'
import { ensureProfile, getCurrentUser, type AppUser } from '@/lib/queries'
import { safeNextPath } from '@/lib/safe-redirect'

const credentialsSchema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(8, 'Use at least 8 characters'),
})

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Check the details you entered'
}

/** Only ever a path on this origin — see lib/safe-redirect.ts for the tricks. */
function safeNext(raw: FormDataEntryValue | null, fallback: string): string {
  return safeNextPath(raw, fallback)
}

/**
 * Email + password signup.
 *
 * Neon Auth's own email verification is OFF, so signUp.email() returns a live
 * session and the user goes straight to onboarding. Verification is tracked by
 * the app instead (profiles.email_verified_at, migration 0012): we email our
 * own link and show an "unverified" banner until it's clicked. Sending that
 * email must never block signup — if Resend is down or unconfigured, we log
 * and move on; the banner lets them ask again.
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

  const fullName = String(formData.get('full_name') ?? '').trim()

  const { data, error } = await getAuth().signUp.email({
    email: parsed.data.email,
    password: parsed.data.password,
    // Better Auth requires a name; an empty one is allowed and the profile
    // stores null for it.
    name: fullName,
  })

  if (error || !data?.user) return { error: friendlyAuthError(error), values }

  // Use the user from the response rather than getCurrentUser(): the session
  // cookie was only just written and that lookup is request-cached.
  const user: AppUser = {
    id: data.user.id,
    email: data.user.email,
    name: data.user.name || null,
    emailVerified: Boolean(data.user.emailVerified),
  }

  // Users live in Neon Auth's schema, so nothing creates our profile row for
  // us — and create_email_verification() reads the address from it.
  try {
    await ensureProfile(user)
  } catch (err) {
    // getProfile() self-heals on the next read, so this is not fatal.
    console.error('[signup] could not create profile', err instanceof Error ? err.message : err)
  }

  const sent = await issueVerificationEmail(user)
  if (sent !== 'created') {
    console.error(`[signup] verification email not sent for new user: ${sent}`)
  }

  redirect('/onboarding')
}

type IssueResult = CreateVerificationResult | 'failed'

/**
 * Mints a verification token for the user and emails the link.
 *
 * Only the SHA-256 of the token reaches the database; the raw token goes into
 * the email and nowhere else. The 60-second rate limit lives in the database
 * function so two tabs can't race past it. Never throws.
 */
async function issueVerificationEmail(user: AppUser): Promise<IssueResult> {
  try {
    const token = generateVerificationToken()

    const status = await createEmailVerification(userDb(user.id), hashVerificationToken(token))
    if (status !== 'created') return status

    await sendVerificationEmail({
      to: user.email,
      name: user.name,
      verifyUrl: verificationUrl(siteUrl(), token),
    })
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
  if (!user?.email) return { error: 'Sign in with an email address first.' }

  switch (await issueVerificationEmail(user)) {
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

  const { error } = await getAuth().signIn.email(parsed.data)

  if (error) {
    // Better Auth deliberately returns the same error for a wrong password and
    // an unknown email so the endpoint can't be used to enumerate accounts.
    // The friendly rewrite keeps that property — one message for both.
    return { error: friendlyAuthError(error), values }
  }

  redirect(safeNext(formData.get('next'), '/dashboard'))
}

export async function signOutAction(): Promise<never> {
  await getAuth().signOut()
  redirect('/')
}

/**
 * Step one of a password reset: Neon Auth emails a link to
 * `<auth base>/reset-password/<token>?callbackURL=<redirectTo>`, which checks
 * the token and bounces to `redirectTo?token=<token>` (or `?error=INVALID_TOKEN`).
 */
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const email = z.email().safeParse(formData.get('email'))
  if (!email.success) return withValues({ error: 'Enter a valid email address' }, formData)

  const { error } = await getAuth().requestPasswordReset({
    email: email.data,
    redirectTo: `${siteUrl()}/reset-password`,
  })

  // Better Auth already answers the same way for unknown addresses. A real
  // failure (rate limit, outage) is logged, but the reply stays neutral so the
  // form can't be used to find out which addresses have accounts.
  if (error) console.error('[forgot-password] request failed', error.code, error.message)

  return { message: 'If that address has an account, a reset link is on its way.' }
}

/** Step two: the token from the emailed link plus the new password. */
export async function resetPasswordAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const token = String(formData.get('token') ?? '')
  const password = String(formData.get('password') ?? '')
  const confirm = String(formData.get('confirm_password') ?? '')

  if (!token) return { error: friendlyAuthError({ code: 'INVALID_TOKEN' }) }
  if (password.length < 8) return { error: 'Use at least 8 characters' }
  if (password !== confirm) return { error: 'Those passwords do not match' }

  const { error } = await getAuth().resetPassword({ newPassword: password, token })

  if (error) return { error: friendlyAuthError(error) }

  // Resetting doesn't sign anyone in; they use the new password next.
  redirect('/login?reset=1')
}

/**
 * Google sign-in. Neon Auth hands back Google's consent URL (and sets the
 * OAuth state cookie on this response); after consent the browser comes back
 * to /auth/callback with a session verifier that proxy.ts exchanges.
 */
export async function signInWithGoogleAction(formData: FormData): Promise<never> {
  const next = safeNext(formData.get('next'), '/dashboard')
  const callbackURL = `${siteUrl()}/auth/callback?next=${encodeURIComponent(next)}`

  const { data, error } = await getAuth().signIn.social({
    provider: 'google',
    callbackURL,
    // A cancelled consent screen comes back here with ?error=…; the callback
    // route turns that into a sentence on /login.
    errorCallbackURL: `${siteUrl()}/auth/callback`,
  })

  const url = data && 'url' in data && typeof data.url === 'string' ? data.url : null

  if (error || !url) {
    redirect(`/login?error=${encodeURIComponent(friendlyAuthError(error ?? 'Could not start Google sign-in'))}`)
  }

  redirect(url)
}
