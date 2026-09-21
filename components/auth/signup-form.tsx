'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { signUpAction } from '@/lib/actions/auth'
import { isAccountExistsError } from '@/lib/auth-messages'
import { keptValues, type AuthFormState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'
import { Divider } from '@/components/auth/login-form'
import { FormError } from '@/components/auth/form-error'
import { GoogleButton } from '@/components/auth/google-button'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SignupForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUpAction, {})
  // A failed signup echoes back name and email (never the password) and the
  // key remounts the form from them, so nothing typed is lost.
  const kept = keptValues(state.values)
  const formKey = useSubmissionKey(state)
  const email = kept.text('email')

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
        <p className="text-sm text-muted-foreground">
          Set up your business once, then every invoice takes a minute.
        </p>
      </div>

      <GoogleButton next="/onboarding" label="Sign up with Google" />

      <Divider />

      <form key={formKey} action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Your name</Label>
          <Input
            id="full_name"
            name="full_name"
            autoComplete="name"
            placeholder="Navdeep"
            defaultValue={kept.text('full_name')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            defaultValue={email}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
        </div>

        <FormError message={state.error} />
        {state.error && isAccountExistsError(state.error) && (
          <p className="text-sm text-muted-foreground">
            <Link
              href={email ? `/login?email=${encodeURIComponent(email)}` : '/login'}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Sign in to that account
            </Link>{' '}
            or{' '}
            <Link
              href="/forgot-password"
              className="font-medium text-foreground underline underline-offset-4"
            >
              reset the password
            </Link>
            .
          </p>
        )}

        <SubmitButton className="w-full" pendingLabel="Creating account…">
          Create account
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Sign in
        </Link>
      </p>
    </div>
  )
}
