'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { requestPasswordResetAction, resetPasswordAction } from '@/lib/actions/auth'
import { keptValues, type AuthFormState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(
    requestPasswordResetAction,
    {},
  )
  // Restores the email if the action echoes `values` (see withValues).
  const kept = keptValues(state.values)
  const formKey = useSubmissionKey(state)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your email and we&rsquo;ll send you a link to set a new one.
        </p>
      </div>

      <form key={formKey} action={formAction} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={kept.text('email')}
            required
          />
        </div>

        <FormError message={state.error} />
        <FormSuccess message={state.message} />

        <SubmitButton className="w-full" pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </form>

      <p className="text-center text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(resetPasswordAction, {})
  // Only password fields here, which are never echoed: clearing them after a
  // failure is intentional. The key just keeps the reset behaviour uniform.
  const formKey = useSubmissionKey(state)

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
        <p className="text-sm text-muted-foreground">
          Pick something you&rsquo;ll remember. You&rsquo;ll sign in with it next.
        </p>
      </div>

      <form key={formKey} action={formAction} className="space-y-4">
        {/* The single-use token from the emailed link is the only credential. */}
        <input type="hidden" name="token" value={token} />

        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm_password">Confirm password</Label>
          <Input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
          />
        </div>

        <FormError message={state.error} />

        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save password
        </SubmitButton>
      </form>

      {state.error && (
        <p className="text-center text-sm text-muted-foreground">
          Link not working?{' '}
          <Link href="/forgot-password" className="font-medium text-foreground underline underline-offset-4">
            Send a new one
          </Link>
        </p>
      )}
    </div>
  )
}
