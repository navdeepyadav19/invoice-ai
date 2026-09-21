import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/app/app-shell'
import { GuestBanner } from '@/components/app/guest-banner'
import { VerifiedToast, VerifyEmailBanner } from '@/components/app/verify-email-banner'
import { isEmailUnverified } from '@/lib/email-verification'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/nav'
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

  // Read on the server so the sidebar renders at the right width on first paint.
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <AppShell
      user={{ email: user.email ?? null, isGuest, emailUnverified: unverified }}
      defaultCollapsed={sidebarCollapsed}
      banners={
        <>
          {isGuest && <GuestBanner />}
          {unverified && user.email && <VerifyEmailBanner email={user.email} />}
        </>
      }
    >
      <Suspense fallback={null}>
        <VerifiedToast />
      </Suspense>
      {children}
    </AppShell>
  )
}
