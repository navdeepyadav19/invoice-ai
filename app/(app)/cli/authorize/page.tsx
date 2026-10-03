import type { Metadata } from 'next'

import { CliAuthorizeForm } from '@/components/cli/cli-authorize-form'
import { PageContainer, PageHeader } from '@/components/app/page-header'
import { SetupWarning } from '@/components/settings/setup-warning'
import type { CliAuthorizeState } from '@/lib/actions/cli-auth'
import { apiSetupStatus } from '@/lib/api/setup-status'
import { contextFromSession } from '@/lib/auth/context'
import { formatUserCode, normaliseUserCode } from '@/lib/cli-auth/device'
import { lookupCliLogin } from '@/lib/cli-auth/lookup'

export const metadata: Metadata = { title: 'Authorize the CLI' }

/**
 * The browser half of `invoice-ai login` (RFC 8628 device flow).
 *
 * The CLI opens /cli/authorize?code=WXYZ-2345. The proxy sends a signed-out
 * visitor to /login with this full URL as `next`, so they come straight back
 * here with the code intact. The (app) layout has already required a session.
 */
export default async function CliAuthorizePage({ searchParams }: PageProps<'/cli/authorize'>) {
  const setup = apiSetupStatus()
  const params = await searchParams

  const header = (
    <PageHeader
      title="Authorize the CLI"
      description="Let the invoice-ai command line tool act on your account from a terminal."
    />
  )

  const raw = typeof params.code === 'string' ? params.code : ''
  const code = normaliseUserCode(raw)
  let initial: CliAuthorizeState = { step: 'enter', values: raw ? { user_code: raw } : undefined }

  if (code) {
    const ctx = await contextFromSession()
    const request = await lookupCliLogin(ctx.db, code).catch(() => null)

    initial = request
      ? { step: 'confirm', userCode: formatUserCode(code), request }
      : {
          step: 'enter',
          error:
            'That code isn’t valid any more — it may have expired or already been used. Run `invoice-ai login` again for a new one.',
          values: { user_code: raw },
        }
  }

  return (
    <PageContainer size="narrow" className="space-y-6">
      {header}
      {!setup.ready ? <SetupWarning missing={setup.missing} /> : null}
      <CliAuthorizeForm initial={initial} ready={setup.ready} />
    </PageContainer>
  )
}
