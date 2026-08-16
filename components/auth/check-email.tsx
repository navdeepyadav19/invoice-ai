'use client'

import Link from 'next/link'
import { MailCheck } from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'

import { resendConfirmationAction } from '@/lib/actions/auth'
import type { AuthFormState } from '@/lib/form-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Button } from '@/components/ui/button'

const COOLDOWN_SECONDS = 60

export function CheckEmail({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    resendConfirmationAction,
    {},
  )
  const [cooldown, setCooldown] = useState(COOLDOWN_SECONDS)

  // The clock starts on mount (signup has just sent one) and restarts on click
  // rather than on the server's reply. Restarting from an effect that watches
  // the response would mean a cascading render, and it would leave the button
  // live for the whole round trip — long enough to double-submit.
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent">
        <MailCheck className="size-6 text-accent-foreground" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Check your inbox</h1>
        <p className="text-sm text-muted-foreground">
          We sent a confirmation link to{' '}
          <span className="font-medium text-foreground">{email || 'your email address'}</span>. Click
          it and we&rsquo;ll take you straight to setup.
        </p>
      </div>

      <form action={formAction} className="space-y-3">
        <input type="hidden" name="email" value={email} />

        <FormError message={state.error} />
        <FormSuccess message={state.message} />

        <Button
          type="submit"
          variant="outline"
          className="w-full"
          disabled={pending || cooldown > 0}
          onClick={() => setCooldown(COOLDOWN_SECONDS)}
        >
          {cooldown > 0 ? `Resend in ${cooldown}s` : pending ? 'Sending…' : 'Resend the link'}
        </Button>
      </form>

      <p className="text-sm text-muted-foreground">
        Wrong address?{' '}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Start over
        </Link>
      </p>
    </div>
  )
}
