'use client'

import { useState, useTransition } from 'react'
import { Bot, ShieldCheck } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { revokeConnectedAppAction } from '@/lib/actions/oauth-grants'
import { clientOrigin, scopeLabel } from '@/lib/connected-apps'
import { SCOPE_DESCRIPTIONS, isScope } from '@/lib/auth/scopes'
import type { OAuthGrantListItem } from '@/lib/db/rpc'

/**
 * The assistants this user has approved, and the one button that undoes it.
 *
 * Same shape as the API key list (components/settings/api-keys-manager.tsx)
 * on purpose: an OAuth grant is a credential someone else holds on your
 * behalf, and it should look and revoke like the other kind.
 */
export function ConnectedApps({ apps }: { apps: OAuthGrantListItem[] }) {
  if (!apps.length) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Bot className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No assistants connected yet.</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Once you approve one using the steps above, it shows up here with exactly what you let it
          do.
        </p>
      </div>
    )
  }

  return (
    <ul className="divide-y rounded-lg border">
      {apps.map((app) => (
        <AppRow key={app.id} app={app} />
      ))}
    </ul>
  )
}

function AppRow({ app }: { app: OAuthGrantListItem }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const origin = clientOrigin(app)

  return (
    <li className="flex flex-wrap items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{app.client_name}</span>
          {app.revoked_at ? <Badge variant="outline">Disconnected</Badge> : null}
          {/* The name is whatever the app told us. Only a CIMD client's domain
              is proven, so that's the only thing worth calling verified. */}
          {origin.verified ? (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              Verified domain: {origin.host}
            </span>
          ) : (
            <Badge
              variant="outline"
              title="This app registered itself and chose its own name. Only connect apps you set up yourself."
            >
              Unverified
            </Badge>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-1">
          {app.scopes.map((scope) => (
            <span
              key={scope}
              title={isScope(scope) ? SCOPE_DESCRIPTIONS[scope] : scope}
              className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
            >
              {scopeLabel(scope)}
            </span>
          ))}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          Connected {formatDate(app.created_at)} · Last used{' '}
          {app.last_used_at ? formatDate(app.last_used_at) : 'Never'}
        </p>

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      {!app.revoked_at ? (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>Revoke</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Disconnect &ldquo;{app.client_name}&rdquo;?</DialogTitle>
              {/* Confirmed because it is instant: the assistant's very next
                  request fails, possibly halfway through something it was
                  doing for you in another window. */}
              <DialogDescription>
                It loses access immediately and can&rsquo;t reconnect on its own. To use it again
                you&rsquo;d add it again and approve it here.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    const result = await revokeConnectedAppAction(app.id)
                    if (result?.error) setError(result.error)
                  })
                }}
              >
                {isPending ? 'Revoking…' : 'Revoke access'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </li>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}
