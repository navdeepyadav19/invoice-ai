import Link from 'next/link'

import { SettingsNav } from '@/components/settings/settings-nav'

/**
 * Settings grew a second page, and then a fourth.
 *
 * Until now "Settings" meant exactly one screen, so the header linked straight
 * at /settings/business. Adding API keys under that URL made a page that
 * existed, built and deployed — and that nobody could navigate to. A shell with
 * its own nav is what stops the next page having the same problem.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your business details, and the credentials other systems use to talk to Invoice-AI.
        </p>
      </div>

      <div className="flex flex-col gap-8 lg:flex-row">
        <SettingsNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>

      <p className="mt-16 border-t pt-6 text-xs text-muted-foreground">
        Building an integration? The full API contract is at{' '}
        <Link className="underline" href="/api/v1/openapi.json">
          /api/v1/openapi.json
        </Link>
        .
      </p>
    </div>
  )
}
