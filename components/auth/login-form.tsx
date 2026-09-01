'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { signInAction } from '@/lib/actions/auth'
import type { AuthFormState } from '@/lib/form-state'
import { GoogleButton } from '@/components/auth/google-button'
import { FormError } from '@/components/auth/form-error'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function LoginForm({ next, initialError }: { next: string; initialError?: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signInAction, {
    error: initialError,
  })

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
        <p className="text-sm text-muted-foreground">Sign in to pick up where you left off.</p>
      </div>

      <GoogleButton next={next} label="Continue with Google" />

      <Divider />

      <form action={formAction} className="space-y-4">
        <input type="hidden" name="next" value={next} />

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
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/forgot-password"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Forgot?
            </Link>
          </div>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>

        <FormError message={state.error} />

        <SubmitButton className="w-full" pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        New here?{' '}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Create an account
        </Link>
      </p>
    </div>
  )
}

export function Divider() {
  return (
    <div className="relative">
      <div className="absolute inset-0 flex items-center">
        <span className="w-full border-t" />
      </div>
      <div className="relative flex justify-center">
        <span className="bg-background px-2 text-xs uppercase tracking-wider text-muted-foreground">
          or
        </span>
      </div>
    </div>
  )
}
