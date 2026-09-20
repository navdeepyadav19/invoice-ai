import type { Metadata } from 'next'

import { ApiKeysManager } from '@/components/settings/api-keys-manager'
import { SetupWarning } from '@/components/settings/setup-warning'
import { listApiKeys } from '@/lib/actions/api-keys'
import { apiSetupStatus } from '@/lib/api/setup-status'
import { getCurrentUser } from '@/lib/queries'
import { siteUrl } from '@/lib/supabase/env'

export const metadata: Metadata = { title: 'API keys' }

/**
 * The only place API keys can be created or revoked.
 *
 * Deliberately not exposed over the API itself — see lib/auth/scopes.ts. A
 * leaked key cannot mint more keys, which keeps the blast radius of a stolen
 * credential fixed at whatever it was granted.
 */
export default async function ApiKeysPage() {
  const user = await getCurrentUser()
  const isGuest = Boolean(user?.is_anonymous)
  const setup = apiSetupStatus()
  const keys = isGuest ? [] : await listApiKeys()

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium">API keys</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Let your own scripts and other tools raise invoices for you over HTTP.
        </p>
      </div>

      {!setup.ready ? <SetupWarning missing={setup.missing} /> : null}

      {isGuest ? (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Guest accounts can&rsquo;t hold API keys — guest data is cleared after 30 days, which
          would leave the key pointing at nothing. Add an email and password first.
        </p>
      ) : (
        <ApiKeysManager keys={keys} ready={setup.ready} />
      )}

      <section className="space-y-3 border-t pt-8">
        <h3 className="text-sm font-medium">Using your key</h3>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
          {`# List your invoices
curl ${siteUrl()}/api/v1/invoices \\
  -H "Authorization: Bearer inv_live_..."

# Issue one. Writes that spend a GST number need an Idempotency-Key,
# so a retry can never assign a second number.
curl -X POST ${siteUrl()}/api/v1/invoices/<id>/issue \\
  -H "Authorization: Bearer inv_live_..." \\
  -H "Idempotency-Key: $(uuidgen)"`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Amounts are integer paise — <code className="text-[11px]">2500000</code> is ₹25,000.
        </p>
      </section>
    </div>
  )
}
