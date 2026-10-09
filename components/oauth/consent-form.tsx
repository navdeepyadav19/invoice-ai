import { BadgeCheck, ShieldAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SCOPE_DESCRIPTIONS, type Scope } from '@/lib/auth/scopes'
import { MCP_DRAFT_SCOPES, MCP_LIFECYCLE_SCOPES, MCP_READ_SCOPES } from '@/lib/mcp/scopes'
import type { AuthorizeRequest } from '@/lib/oauth/authorize'
import { redirectHost } from '@/lib/oauth/redirect-uri'
import { dependenciesOf } from '@/lib/oauth/scopes'

/**
 * The consent screen: who is asking, where the answer goes, and exactly what
 * they may do — grouped by risk, with the risky group left unticked.
 *
 * A plain HTML form (no client JavaScript): it posts the original request and
 * a signed consent token to /oauth/authorize/decision, which re-checks both.
 *
 * App logos are deliberately not shown. For a dynamically registered app the
 * logo is whatever URL the registrant typed — an image that can impersonate a
 * brand and that tells its host who viewed this page.
 */
export function ConsentForm({
  request,
  query,
  consentToken,
  userEmail,
  noScopesError,
}: {
  request: AuthorizeRequest
  query: string
  consentToken: string
  userEmail: string | null
  noScopesError: boolean
}) {
  const { client } = request
  const verifiedDomain = client.kind === 'cimd' ? new URL(client.clientId).host : null
  const returnHost = redirectHost(request.redirectUri)
  const returnsToThisComputer = /^(127\.0\.0\.1|\[::1\]|localhost)(:|$)/.test(returnHost)
  // A verified app should send you back to its own site. If it doesn't (or it
  // returns to a program on this computer, which any local program can
  // claim to be), say so: the verified name alone is not the whole story.
  const returnWarning = verifiedDomain
    ? returnsToThisComputer
      ? 'This sign-in returns to a program on this computer. Approve only if you just started it yourself.'
      : returnHost !== verifiedDomain && !returnHost.endsWith(`.${verifiedDomain}`)
        ? `After you approve, you'll be sent to ${returnHost}, not ${verifiedDomain}.`
        : null
    : null
  const preTicked = new Set(request.requestedScopes.filter((s) => !(MCP_LIFECYCLE_SCOPES as readonly Scope[]).includes(s)))

  const groups: Array<{ title: string; note?: string; scopes: readonly Scope[] }> =
    request.audience === 'mcp'
      ? [
          { title: 'Look things up', scopes: MCP_READ_SCOPES },
          { title: 'Create customers and draft invoices', note: 'Drafts have no number and send nothing.', scopes: MCP_DRAFT_SCOPES },
          {
            title: 'Finalize, email, and record payments',
            note: 'One-way actions. Even with these, each one asks you to confirm in the chat first.',
            scopes: MCP_LIFECYCLE_SCOPES,
          },
        ]
      : [{ title: 'Permissions', scopes: request.offeredScopes }]

  return (
    <form method="post" action="/oauth/authorize/decision" className="space-y-6 rounded-lg border p-6">
      <input type="hidden" name="request" value={query} />
      <input type="hidden" name="consent_token" value={consentToken} />

      <header className="space-y-3">
        <div className="flex size-11 items-center justify-center rounded-lg bg-muted text-lg font-semibold" aria-hidden>
          {client.name.slice(0, 1).toUpperCase()}
        </div>
        {/* An unverified app chose its own name, so the heading says so
            rather than presenting "Claude" (or any brand) as fact. */}
        <h1 className="text-lg font-semibold leading-snug">
          {verifiedDomain ? (
            <>{client.name} wants to access your Invoice-AI account</>
          ) : (
            <>An app calling itself &ldquo;{client.name}&rdquo; wants to access your Invoice-AI account</>
          )}
        </h1>
        {verifiedDomain ? (
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <BadgeCheck className="size-4 text-emerald-600" aria-hidden />
            Verified domain: <span className="font-medium text-foreground">{verifiedDomain}</span>
          </p>
        ) : null}
        {verifiedDomain && returnWarning ? (
          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {returnWarning}
          </p>
        ) : null}
        {verifiedDomain ? null : (
          <div className="space-y-1.5 text-sm text-muted-foreground">
            <Badge variant="outline" className="gap-1">
              <ShieldAlert className="size-3.5" aria-hidden />
              Unverified app
            </Badge>
            <p>
              Invoice-AI can&rsquo;t confirm who made this app or that its name is real. After you approve, it will
              be sent to <span className="font-medium text-foreground">{returnHost}</span>. Only continue if you
              started this yourself, from an app you trust.
            </p>
          </div>
        )}
        {userEmail ? <p className="text-xs text-muted-foreground">Signed in as {userEmail}</p> : null}
      </header>

      <div className="space-y-5">
        {groups.map((group) => (
          <fieldset key={group.title} className="space-y-2">
            <legend className="text-sm font-medium">{group.title}</legend>
            {group.note ? <p className="text-xs text-muted-foreground">{group.note}</p> : null}
            {group.scopes.map((scope) => {
              const needs = dependenciesOf(scope)
              return (
                <label key={scope} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope}
                    defaultChecked={preTicked.has(scope)}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span className="min-w-0">
                    {SCOPE_DESCRIPTIONS[scope]}
                    <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                      {scope}
                      {needs.length ? ` · also lets it read ${needs.join(', ')}` : ''}
                    </span>
                  </span>
                </label>
              )
            })}
          </fieldset>
        ))}
      </div>

      {noScopesError ? <p className="text-sm text-destructive">Choose at least one permission, or deny the request.</p> : null}

      <div className="space-y-3">
        <div className="flex gap-2">
          <Button type="submit" name="intent" value="approve" className="flex-1">
            Approve
          </Button>
          <Button type="submit" name="intent" value="deny" variant="outline" className="flex-1">
            Deny
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          You can disconnect {client.name} at any time in Settings → AI assistants.
        </p>
      </div>
    </form>
  )
}
