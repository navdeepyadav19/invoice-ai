import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppHeader } from '@/components/app/app-header'
import { GuestBanner } from '@/components/app/guest-banner'
import { VerifiedToast, VerifyEmailBanner } from '@/components/app/verify-email-banner'
import { isEmailUnverified } from '@/lib/email-verification'
import { getProfile, needsOnboarding, requireUser } from '@/lib/queries'

/**
 * The gate. Everything under (app) needs a session, and a permanent user needs
 * to have finished onboarding — otherwise they land in the builder with no
 * business details and nothing works.
 *
 * Onboarding deliberately lives outside this group, in (setup), so this
 * redirect can be unconditional instead of having to except its own path.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser()
  const profile = await getProfile()

  if (needsOnboarding(user, profile)) redirect('/onboarding')

  const isGuest = Boolean(user.is_anonymous)
  // Unverified is a nudge, never a gate: signup lets people straight in.
  const unverified = isEmailUnverified(user, profile)

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader email={user.email ?? null} isGuest={isGuest} emailUnverified={unverified} />
      {isGuest && <GuestBanner />}
      {unverified && user.email && <VerifyEmailBanner email={user.email} />}
      <Suspense fallback={null}>
        <VerifiedToast />
      </Suspense>
      <main className="flex-1">{children}</main>
    </div>
  )
}
