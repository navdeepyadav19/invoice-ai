import { redirect } from 'next/navigation'

import { AppHeader } from '@/components/app/app-header'
import { GuestBanner } from '@/components/app/guest-banner'
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

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader email={user.email ?? null} isGuest={isGuest} />
      {isGuest && <GuestBanner />}
      <main className="flex-1">{children}</main>
    </div>
  )
}
