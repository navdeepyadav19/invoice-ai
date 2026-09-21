import type { Metadata } from 'next'
import Link from 'next/link'
import { CircleAlert, CircleCheck } from 'lucide-react'

import { describeRedeemResult, toRedeemResult } from '@/lib/email-verification'
import { getCurrentUser } from '@/lib/queries'
import { Button } from '@/components/ui/button'

export const metadata: Metadata = { title: 'Verify your email' }

/**
 * The explainer /auth/verify sends people to when a link can't be used —
 * expired, already used, sent to an old address, or mangled. The status comes
 * from the query string, so it is narrowed to a known value before rendering.
 */
export default async function VerifyEmailPage({ searchParams }: PageProps<'/verify-email'>) {
  const params = await searchParams
  const result = toRedeemResult(params.status)
  const user = await getCurrentUser()
  const signedIn = Boolean(user && !user.is_anonymous)

  const { title, body, ok } = describeRedeemResult(result, signedIn)

  return (
    <div className="space-y-6 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent">
        {ok ? (
          <CircleCheck className="size-6 text-accent-foreground" />
        ) : (
          <CircleAlert className="size-6 text-accent-foreground" />
        )}
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>

      <Button
        className="w-full"
        nativeButton={false}
        render={<Link href={signedIn ? '/dashboard' : '/login'} />}
      >
        {signedIn ? 'Go to your dashboard' : 'Sign in'}
      </Button>
    </div>
  )
}
