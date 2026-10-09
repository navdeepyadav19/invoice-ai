import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ConsentForm } from '@/components/oauth/consent-form'
import { getCurrentUser } from '@/lib/queries'
import { parseAuthorizeRequest, signConsent } from '@/lib/oauth/authorize'
import { resolveClient } from '@/lib/oauth/handlers'
import { oauthDeps } from '@/lib/oauth/store'

export const metadata: Metadata = { title: 'Connect an app' }

/**
 * GET /oauth/authorize — the screen where a user decides what an app may do.
 *
 * The request is checked before anything is shown (lib/oauth/authorize.ts):
 * an unknown app or a return address it didn't register gets an error page,
 * never a redirect. A valid request gets the consent form, carrying the
 * original query and a short-lived token that ties the decision to this user
 * and this exact request.
 */
export default async function AuthorizePage({ searchParams }: PageProps<'/oauth/authorize'>) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    // The page's own notice flag is not part of the app's request.
    if (key === 'consent_error') continue
    if (typeof value === 'string') query.set(key, value)
  }

  const deps = oauthDeps()
  const user = await getCurrentUser()
  const parsed = await parseAuthorizeRequest(query, (id) => resolveClient(id, deps, user?.id))

  if (parsed.kind === 'redirect_error') redirect(parsed.url)
  if (parsed.kind === 'show_error') {
    return (
      <div className="space-y-3 rounded-lg border p-6">
        <h1 className="text-lg font-semibold">This connection can&rsquo;t continue</h1>
        <p className="text-sm text-muted-foreground">{parsed.message}</p>
      </div>
    )
  }

  const canonical = query.toString()

  return (
    <ConsentForm
      request={parsed.request}
      query={canonical}
      consentToken={signConsent(user!.id, canonical)}
      userEmail={user?.email ?? null}
      noScopesError={params.consent_error === 'no_scopes'}
    />
  )
}
