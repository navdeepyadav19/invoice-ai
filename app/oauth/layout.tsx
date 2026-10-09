import { redirect } from 'next/navigation'

import { Wordmark } from '@/components/brand'
import { getProfile, needsOnboarding, requireUser } from '@/lib/queries'

/**
 * The frame around the consent screen: the same quiet layout as sign-in, so
 * it reads as Invoice-AI asking, not as part of the app it's asking for.
 *
 * Signed out is handled before this (the proxy sends /login?next=…). A user
 * who hasn't finished onboarding goes there first; the proxy has noted this
 * URL, so they come back here afterwards (lib/auth/return-to.ts).
 */
export default async function OAuthLayout({ children }: LayoutProps<'/oauth'>) {
  await requireUser()
  if (needsOnboarding(await getProfile())) redirect('/onboarding')

  return (
    <div className="relative flex min-h-svh flex-col">
      <header className="relative px-6 py-6">
        <Wordmark />
      </header>
      <main className="relative flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}
