import { Suspense } from 'react'

import { signOutAction } from '@/lib/actions/auth'
import { isEmailUnverified } from '@/lib/email-verification'
import { getCurrentUser, getProfile } from '@/lib/queries'
import { VerifiedToast, VerifyEmailBanner } from '@/components/app/verify-email-banner'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'

/**
 * Onboarding sits in its own route group rather than under (app) so the app
 * layout's "you must finish onboarding" redirect can be unconditional — a
 * wizard living inside the thing it gates would redirect to itself forever.
 */
export default async function SetupLayout({ children }: LayoutProps<'/'>) {
  // Both are request-cached, so the onboarding page's own calls are free.
  // Signup drops people here straight away, which is why the unverified banner
  // appears in setup too — it's the first screen a new account ever sees.
  const user = await getCurrentUser()
  const profile = await getProfile()
  const unverified = isEmailUnverified(user, profile)

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b border-border/70">
        <div className="mx-auto flex h-16 w-full max-w-3xl items-center justify-between px-6">
          <Wordmark />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="text-muted-foreground">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {unverified && user?.email && <VerifyEmailBanner email={user.email} />}
      <Suspense fallback={null}>
        <VerifiedToast />
      </Suspense>

      <main className="flex-1 px-6 py-10 sm:py-14">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  )
}
