import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { Suspense } from 'react'

import { AppShell } from '@/components/app/app-shell'
import { VerifiedToast, VerifyEmailBanner } from '@/components/app/verify-email-banner'
import { isEmailUnverified } from '@/lib/email-verification'
import { SIDEBAR_COLLAPSED_COOKIE } from '@/lib/nav'
import { getProfile, needsOnboarding, requireUser } from '@/lib/queries'

/**
 * The gate. Everything under (app) needs a session, and the user needs to have
 * finished onboarding — otherwise they land in the builder with no
 * business details and nothing works.
 *
 * Onboarding deliberately lives outside this group, in (setup), so this
 * redirect can be unconditional instead of having to except its own path.
 */
export default async function AppLayout({ children }: LayoutProps<'/'>) {
  const user = await requireUser()
  const profile = await getProfile()

  if (needsOnboarding(profile)) redirect('/onboarding')

  // Unverified is a nudge, never a gate: signup lets people straight in.
  const unverified = isEmailUnverified(user, profile)

  // Read on the server so the sidebar renders at the right width on first paint.
  const cookieStore = await cookies()
  const sidebarCollapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === '1'

  return (
    <AppShell
      user={{ email: user.email || null, emailUnverified: unverified }}
      defaultCollapsed={sidebarCollapsed}
      banners={unverified && user.email ? <VerifyEmailBanner email={user.email} /> : null}
    >
      <Suspense fallback={null}>
        <VerifiedToast />
      </Suspense>
      {children}
    </AppShell>
  )
}
