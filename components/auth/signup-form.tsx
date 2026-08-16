'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { signUpAction } from '@/lib/actions/auth'
import type { AuthFormState } from '@/lib/form-state'
import { Divider } from '@/components/auth/login-form'
import { FormError } from '@/components/auth/form-error'
import { GoogleButton } from '@/components/auth/google-button'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function SignupForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUpAction, {})

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

      <form action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="full_name">Your name</Label>
          <Input id="full_name" name="full_name" autoComplete="name" placeholder="Navdeep" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
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
