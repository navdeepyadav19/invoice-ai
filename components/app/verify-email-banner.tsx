'use client'

import { MailWarning } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useActionState, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

import { resendVerificationEmailAction } from '@/lib/actions/auth'
import { RESEND_COOLDOWN_SECONDS } from '@/lib/email-verification'
import type { AuthFormState } from '@/lib/form-state'

/**
 * Shown to signed-in users whose email isn't verified yet.
 *
 * Deliberately a nudge, not a gate: signup lets people straight into setup, and
 * everything works while unverified. The resend button is rate limited in the
 * database (one link per 60 seconds); the client-side countdown only exists so
 * people don't click into that limit and get an error.
 */
export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    resendVerificationEmailAction,
    {},
  )
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000)
    return () => clearTimeout(timer)
  }, [cooldown])

  return (
    <div className="border-b border-warning/25 bg-warning/[0.08]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2.5 text-sm">
        <MailWarning className="size-4 shrink-0 text-warning" />
        <span className="text-foreground">
          Your email <span className="font-medium">{email}</span> isn&rsquo;t verified yet.
        </span>

        <form action={formAction} className="inline">
          <button
            type="submit"
            disabled={pending || cooldown > 0}
            onClick={() => setCooldown(RESEND_COOLDOWN_SECONDS)}
            className="font-medium text-primary underline underline-offset-4 hover:opacity-80 disabled:cursor-not-allowed disabled:no-underline disabled:opacity-60"
          >
            {pending
              ? 'Sending…'
              : cooldown > 0
                ? `Resend in ${cooldown}s`
                : 'Resend verification email'}
          </button>
        </form>

        {state.message && (
          <span role="status" className="text-muted-foreground">
            {state.message}
          </span>
        )}
        {state.error && (
          <span role="alert" className="text-destructive">
            {state.error}
          </span>
        )}
      </div>
    </div>
  )
}

/**
 * /auth/verify lands here with ?verified=1. Show a one-off confirmation and
 * strip the flag so a refresh or a shared URL doesn't repeat it.
 *
 * Reads useSearchParams, so mount it inside a <Suspense> boundary.
 */
export function VerifiedToast() {
  const params = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const shown = useRef(false)

  useEffect(() => {
    if (params.get('verified') !== '1' || shown.current) return
    shown.current = true

    toast.success('Email verified — thanks!')

    const rest = new URLSearchParams(params)
    rest.delete('verified')
    const query = rest.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }, [params, pathname, router])

  return null
}
