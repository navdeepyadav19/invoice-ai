import Link from 'next/link'

import { PageContainer, PageHeader } from '@/components/app/page-header'
import { SettingsNav } from '@/components/settings/settings-nav'

/**
 * Shared frame for every settings page.
 *
 * On md+ the app sidebar's "Settings" group is the navigation between these
 * pages, so the in-page section tabs (SettingsNav) only render on small
 * screens, where the sidebar is tucked away in a drawer.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <PageContainer size="default" className="max-w-5xl">
      <PageHeader
        className="mb-8"
        title="Settings"
        description="Your business details, and the credentials other systems use to talk to Invoice-AI."
      />

      <div className="flex flex-col gap-6">
        <SettingsNav />
        <div className="min-w-0">{children}</div>
      </div>

      <p className="mt-16 border-t pt-6 text-xs text-muted-foreground">
        Building an integration? The full API contract is at{' '}
        <Link className="underline" href="/api/v1/openapi.json">
          /api/v1/openapi.json
        </Link>
        .
      </p>
    </PageContainer>
  )
}
