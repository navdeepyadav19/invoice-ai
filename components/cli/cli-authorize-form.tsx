'use client'

import { useActionState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ShieldX, Terminal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cliAuthorizeAction, type CliAuthorizeState } from '@/lib/actions/cli-auth'
import { SCOPE_DESCRIPTIONS } from '@/lib/auth/scopes'
import { CLI_DEFAULT_SCOPES } from '@/lib/cli-auth/scopes'
import { keptValues } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'

export function CliAuthorizeForm({ initial, ready }: { initial: CliAuthorizeState; ready: boolean }) {
  const [state, formAction, pending] = useActionState(cliAuthorizeAction, initial)
  const kept = keptValues(state.values)
  const formKey = useSubmissionKey(state)

  if (state.step === 'approved') {
    return (
      <Outcome
        icon={<CheckCircle2 className="size-6 text-emerald-600" />}
        title="The CLI is signed in"
        body={
          <>
            Return to your terminal — it will pick up the key in a few seconds. The key is listed
            as <strong>CLI · {state.request?.clientName}</strong> in{' '}
            <Link href="/settings/api-keys" className="underline underline-offset-4">
              Settings → API keys
            </Link>
            , where you can revoke it at any time.
          </>
        }
      />
    )
  }

  if (state.step === 'denied') {
    return (
      <Outcome
        icon={<ShieldX className="size-6 text-muted-foreground" />}
        title="Request denied"
        body="Nothing was shared with the CLI. You can close this tab."
      />
    )
  }

  if (state.step === 'confirm' && state.request) {
    const { request } = state

    return (
      <form key={formKey} action={formAction} className="space-y-6">
        <input type="hidden" name="user_code" value={state.userCode} />

        <section className="rounded-lg border p-5">
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="text-sm font-medium">
                Invoice-AI CLI on <span className="font-semibold">{request.clientName}</span>
                {request.clientOs ? (
                  <span className="text-muted-foreground"> ({request.clientOs})</span>
                ) : null}{' '}
                wants access to your account.
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                Check that your terminal shows{' '}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold tracking-widest text-foreground">
                  {state.userCode}
                </code>
                . Only authorize a login you started yourself — anyone who sent you this link
                would get the same access as you.
              </p>
            </div>
          </div>
        </section>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">What may it do?</legend>
          <p className="text-xs text-muted-foreground">
            Untick anything the CLI shouldn&rsquo;t be able to do. Managing API keys is never
            included.
          </p>

          <div className="grid gap-2 sm:grid-cols-2">
            {CLI_DEFAULT_SCOPES.map((scope) => (
              <label key={scope} className="flex items-start gap-3 rounded-md border p-3 text-sm">
                <Checkbox
                  name="scopes"
                  value={scope}
                  defaultChecked={kept.checked('scopes', scope, true)}
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

          {state.fieldErrors?.scopes ? (
            <p className="text-xs text-destructive">{state.fieldErrors.scopes}</p>
          ) : null}
        </fieldset>

        {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" name="intent" value="approve" disabled={pending || !ready}>
            {pending ? 'Working…' : 'Authorize'}
          </Button>
          <Button type="submit" name="intent" value="deny" variant="outline" disabled={pending}>
            Deny
          </Button>
          <span className="text-xs text-muted-foreground">
            Expires {formatTime(request.expiresAt)}
          </span>
        </div>
      </form>
    )
  }

  return (
    <form key={formKey} action={formAction} className="space-y-4 rounded-lg border p-5">
      <input type="hidden" name="intent" value="lookup" />

      <div className="space-y-2">
        <Label htmlFor="user-code">Code from your terminal</Label>
        <Input
          id="user-code"
          name="user_code"
          placeholder="XXXX-XXXX"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus
          maxLength={20}
          defaultValue={kept.text('user_code')}
          aria-invalid={Boolean(state.fieldErrors?.user_code)}
          className="max-w-48 font-mono text-base tracking-widest uppercase"
        />
        {state.fieldErrors?.user_code ? (
          <p className="text-xs text-destructive">{state.fieldErrors.user_code}</p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Run <code className="text-[11px]">invoice-ai login</code> to get one.
          </p>
        )}
      </div>

      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

      <Button type="submit" disabled={pending}>
        {pending ? 'Checking…' : 'Continue'}
      </Button>
    </form>
  )
}

function Outcome({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: React.ReactNode
}) {
  return (
    <section className="flex items-start gap-3 rounded-lg border p-5" role="status">
      {icon}
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      </div>
    </section>
  )
}

function formatTime(value: string): string {
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
