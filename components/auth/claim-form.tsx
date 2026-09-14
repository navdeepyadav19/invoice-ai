'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { claimAccountAction } from '@/lib/actions/claim'
import type { ClaimState } from '@/lib/claim-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export function ClaimForm({ invoiceCount }: { invoiceCount: number }) {
  const [state, formAction] = useActionState<ClaimState, FormData>(claimAccountAction, {})

  if (state.message) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">Almost there</h1>
        <FormSuccess message={state.message} />
        <Button className="w-full" nativeButton={false} render={<Link href="/dashboard" />}>
          Back to my invoices
        </Button>
      </div>
    )
  }

  // The address is taken, so we can't attach it to this guest user. We've minted
  // a transfer token; signing in to the existing account redeems it.
  if (state.conflictEmail) {
    return (
      <div className="space-y-5">
        <h1 className="text-2xl font-semibold tracking-tight">You already have an account</h1>
        <p className="text-sm text-muted-foreground">
          <span className="font-medium text-foreground">{state.conflictEmail}</span> is already
          registered. Sign in and we&rsquo;ll move{' '}
          {invoiceCount === 1 ? 'this invoice' : `these ${invoiceCount} invoices`} across to it.
        </p>

        <Button className="w-full" nativeButton={false} render={<Link href="/login" />}>
          Sign in and transfer
        </Button>

        <p className="text-center text-xs text-muted-foreground">
          The transfer link expires in 30 minutes.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">Save your work</h1>
        <p className="text-sm text-muted-foreground">
          Add an email and password to keep{' '}
          {invoiceCount === 1 ? 'your invoice' : `your ${invoiceCount} invoices`}. Nothing moves and
          nothing is lost — this becomes your account.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
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

        <SubmitButton className="w-full" pendingLabel="Saving…">
          Save my account
        </SubmitButton>
      </form>
    </div>
  )
}
