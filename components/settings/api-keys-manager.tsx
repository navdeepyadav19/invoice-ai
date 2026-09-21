'use client'

import { useActionState, useState, useTransition } from 'react'
import { AlertTriangle, Check, Copy, KeyRound } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
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
import { createApiKeyAction, revokeApiKeyAction, type CreateKeyState } from '@/lib/actions/api-keys'
import { SCOPES, SCOPE_DESCRIPTIONS, type Scope } from '@/lib/auth/scopes'
import type { ApiKeyRow } from '@/lib/database.types'
import { keptValues } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'

/**
 * Nine checkboxes is a decision nobody wants to make.
 *
 * Presets cover what people actually ask for — "let my reporting tool read
 * invoices", "let Zapier do everything" — and Custom stays for the cases that
 * don't fit. Defaulting to Read-only means the careless path is the safe one.
 */
const PRESETS: { id: string; label: string; hint: string; scopes: Scope[] }[] = [
  {
    id: 'read',
    label: 'Read only',
    hint: 'See invoices, clients and your business profile. Cannot change anything.',
    scopes: ['business:read', 'clients:read', 'invoices:read'],
  },
  {
    id: 'billing',
    label: 'Raise and send invoices',
    hint: 'Everything in read-only, plus create, issue, email and mark paid.',
    scopes: [
      'business:read',
      'clients:read',
      'clients:write',
      'invoices:read',
      'invoices:write',
      'invoices:finalize',
      'invoices:send',
      'payments:write',
    ],
  },
  { id: 'custom', label: 'Custom', hint: 'Pick exactly what this integration needs.', scopes: [] },
]

export function ApiKeysManager({ keys, ready }: { keys: ApiKeyRow[]; ready: boolean }) {
  const [state, formAction, pending] = useActionState<CreateKeyState, FormData>(
    async (_previous, formData) => createApiKeyAction(formData),
    {},
  )
  // A failed create echoes name/scopes/expiry back; a successful one doesn't,
  // so the remounted form starts empty again. The plaintext key is never echoed.
  const kept = keptValues(state.values)
  const formKey = useSubmissionKey(state)

  const [preset, setPreset] = useState('read')
  const selected = PRESETS.find((p) => p.id === preset) ?? PRESETS[0]

  return (
    <div className="space-y-10">
      {state.plaintext ? <RevealedKey plaintext={state.plaintext} /> : null}

      <section className="space-y-6 rounded-lg border p-5">
        <div>
          <h2 className="text-sm font-medium">Create a key</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            You&rsquo;ll see the key once, right after creating it. We store a hash, not the key
            itself, so we can&rsquo;t show it to you again.
          </p>
        </div>

        <form key={formKey} action={formAction} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="key-name">What is it for?</Label>
            <Input
              id="key-name"
              name="name"
              placeholder="Zapier, my laptop, the billing cron…"
              defaultValue={kept.text('name')}
              aria-invalid={Boolean(state.fieldErrors?.name)}
              className="max-w-sm"
            />
            {state.fieldErrors?.name ? (
              <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                So you know which one to revoke later without guessing.
              </p>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">What may it do?</legend>

            <div className="flex flex-wrap gap-2">
              {PRESETS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setPreset(option.id)}
                  aria-pressed={preset === option.id}
                  className={
                    preset === option.id
                      ? 'rounded-full border border-primary bg-primary/10 px-3 py-1 text-xs font-medium'
                      : 'rounded-full border px-3 py-1 text-xs text-muted-foreground hover:bg-accent'
                  }
                >
                  {option.label}
                </button>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">{selected.hint}</p>

            {preset === 'custom' ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {SCOPES.map((scope) => (
                  <label
                    key={scope}
                    className="flex items-start gap-3 rounded-md border p-3 text-sm"
                  >
                    <Checkbox
                      name="scopes"
                      value={scope}
                      defaultChecked={kept.checked('scopes', scope)}
                      className="mt-0.5"
                    />
                    <span className="min-w-0">
                      <code className="text-xs font-medium">{scope}</code>
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {SCOPE_DESCRIPTIONS[scope]}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {selected.scopes.map((scope) => (
                  <li key={scope} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Check className="size-3 shrink-0 text-primary" />
                    <code className="text-[11px]">{scope}</code>
                    <span className="truncate">— {SCOPE_DESCRIPTIONS[scope]}</span>
                    <input type="hidden" name="scopes" value={scope} />
                  </li>
                ))}
              </ul>
            )}

            {state.fieldErrors?.scopes ? (
              <p className="text-xs text-destructive">{state.fieldErrors.scopes}</p>
            ) : null}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="key-expiry">Expires after (days)</Label>
            <Input
              id="key-expiry"
              name="expires_in_days"
              type="number"
              min={0}
              defaultValue={kept.text('expires_in_days', 0)}
              className="max-w-32"
            />
            <p className="text-xs text-muted-foreground">
              0 means it never expires. An expiry is a safety net for a key you might forget about.
            </p>
          </div>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button type="submit" disabled={pending || !ready}>
            <KeyRound className="size-4" />
            {pending ? 'Creating…' : 'Create key'}
          </Button>

          {!ready ? (
            <p className="text-xs text-muted-foreground">
              Key creation is disabled until the API is configured on this deployment.
            </p>
          ) : null}
        </form>
      </section>

      <KeyList keys={keys} />
    </div>
  )
}

function RevealedKey({ plaintext }: { plaintext: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Copy this key now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is the only time it will be shown. We store a hash, not the key, so we genuinely
            cannot show it again — if you lose it, revoke it and create another.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
              {plaintext}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(plaintext).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function KeyList({ keys }: { keys: ApiKeyRow[] }) {
  if (!keys.length) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <KeyRound className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No API keys yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Create one above to let a script, a tool like Zapier, or your own backend raise invoices
          without opening this site.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Your keys</h2>

      <ul className="divide-y rounded-lg border">
        {keys.map((key) => (
          <KeyRow key={key.id} row={key} />
        ))}
      </ul>
    </section>
  )
}

function KeyRow({ row }: { row: ApiKeyRow }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <li className="flex flex-wrap items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{row.name}</span>
          <Status row={row} />
        </div>

        <code className="mt-1 block font-mono text-xs text-muted-foreground">{row.prefix}…</code>

        <div className="mt-2 flex flex-wrap gap-1">
          {row.scopes.map((scope) => (
            <span key={scope} className="rounded bg-muted px-1.5 py-0.5 text-[11px]">
              {scope}
            </span>
          ))}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {row.last_used_at
            ? `Last used ${formatDate(row.last_used_at)}`
            : 'Never used — if an integration is failing, it may not be reaching us at all'}
          {row.expires_at ? ` · Expires ${formatDate(row.expires_at)}` : ''}
        </p>

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      {!row.revoked_at ? (
        <Dialog>
          <DialogTrigger render={<Button variant="outline" size="sm" />}>Revoke</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Revoke &ldquo;{row.name}&rdquo;?</DialogTitle>
              {/* Confirmation because this is instant and irreversible — and the
                  thing it breaks is usually a production integration, which
                  fails somewhere the person clicking cannot see. */}
              <DialogDescription>
                Anything using this key stops working immediately, and it cannot be un-revoked.
                You&rsquo;d need to create a new key and update wherever it&rsquo;s configured.
              </DialogDescription>
            </DialogHeader>

            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
              <Button
                variant="destructive"
                disabled={isPending}
                onClick={() => {
                  startTransition(async () => {
                    // The old version dropped the result, so a failed revoke
                    // looked exactly like a successful one.
                    const result = await revokeApiKeyAction(row.id)
                    if (result?.error) setError(result.error)
                  })
                }}
              >
                {isPending ? 'Revoking…' : 'Revoke key'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </li>
  )
}

function Status({ row }: { row: ApiKeyRow }) {
  if (row.revoked_at) return <Badge variant="outline">Revoked</Badge>
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    return <Badge variant="outline">Expired</Badge>
  }
  return <Badge>Active</Badge>
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}
