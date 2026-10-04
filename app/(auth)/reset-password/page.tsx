import type { Metadata } from 'next'
import Link from 'next/link'
import { CircleAlert } from 'lucide-react'

import { ResetPasswordForm } from '@/components/auth/password-forms'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Choose a new password' }

/**
 * Where the emailed reset link ends up. Neon Auth checks the token first and
 * then redirects here with `?token=…` when it's good, or `?error=INVALID_TOKEN`
 * when it's unknown, used or expired. The token is single-use and only proves
 * itself when the new password is submitted with it, so no session is needed.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<'/reset-password'>) {
  const params = await searchParams
  const token = typeof params.token === 'string' ? params.token : ''

  if (params.error || !token) return <InvalidLink />

  return <ResetPasswordForm token={token} />
}

function InvalidLink() {
  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent">
        <CircleAlert className="size-6 text-accent-foreground" />
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">That reset link has expired</h1>
        <p className="text-sm text-muted-foreground">
          Reset links work once and only for a short while. Ask for a fresh one and use the newest
          email.
        </p>
      </div>

      <Button className="w-full" nativeButton={false} render={<Link href="/forgot-password" />}>
        Send a new link
      </Button>
    </div>
  )
}
