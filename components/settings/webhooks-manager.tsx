'use client'

import { useActionState, useState, useTransition } from 'react'
import { AlertTriangle, Check, Copy, Webhook } from 'lucide-react'

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
import {
  createWebhookAction,
  deleteWebhookAction,
  type CreateWebhookState,
} from '@/lib/actions/webhooks'
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_LABELS } from '@/lib/webhooks/events'
import type { WebhookDeliveryRow, WebhookEndpointRow } from '@/lib/database.types'

export function WebhooksManager({
  endpoints,
  deliveries,
}: {
  endpoints: WebhookEndpointRow[]
  deliveries: WebhookDeliveryRow[]
}) {
  const [state, formAction, pending] = useActionState<CreateWebhookState, FormData>(
    async (_previous, formData) => createWebhookAction(formData),
    {},
  )

  return (
    <div className="space-y-10">
      {state.secret ? <RevealedSecret secret={state.secret} url={state.url ?? ''} /> : null}

      <section className="space-y-6 rounded-lg border p-5">
        <div>
          <h2 className="text-sm font-medium">Add an endpoint</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            We&rsquo;ll POST a signed JSON payload to this URL whenever one of the chosen things
            happens, so another system can react without polling us.
          </p>
        </div>

        <form action={formAction} className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="webhook-url">URL</Label>
            <Input
              id="webhook-url"
              name="url"
              type="url"
              placeholder="https://your-system.example/hooks/invoice-ai"
              aria-invalid={Boolean(state.fieldErrors?.url)}
            />
            {state.fieldErrors?.url ? (
              <p className="text-xs text-destructive">{state.fieldErrors.url}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Must be https, and must be reachable from the public internet — a localhost or
                private address is rejected.
              </p>
            )}
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Send me events for</legend>
            <p className="text-xs text-muted-foreground">
              Tick nothing to receive everything, including event types we add later.
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {WEBHOOK_EVENTS.map((event) => (
                <label key={event} className="flex items-start gap-3 rounded-md border p-3">
                  <Checkbox name="events" value={event} className="mt-0.5" />
                  <span className="min-w-0">
                    <span className="block text-sm">{WEBHOOK_EVENT_LABELS[event] ?? event}</span>
                    <code className="mt-0.5 block text-[11px] text-muted-foreground">{event}</code>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

          <Button type="submit" disabled={pending}>
            <Webhook className="size-4" />
            {pending ? 'Adding…' : 'Add endpoint'}
          </Button>
        </form>
      </section>

      <EndpointList endpoints={endpoints} />
      <DeliveryLog deliveries={deliveries} />
    </div>
  )
}

function RevealedSecret({ secret, url }: { secret: string; url: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Copy this signing secret now</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Your receiver at <code className="text-[11px]">{url}</code> uses it to prove a request
            really came from us. Shown once.
          </p>

          <div className="mt-3 flex items-center gap-2">
            <code className="min-w-0 flex-1 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">
              {secret}
            </code>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(secret).then(() => {
                  setCopied(true)
                  setTimeout(() => setCopied(false), 2000)
                })
              }}
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            Verify the HMAC-SHA256 of{' '}
            <code className="text-[11px]">&#123;webhook-id&#125;.&#123;webhook-timestamp&#125;.&#123;body&#125;</code>{' '}
            against the <code className="text-[11px]">webhook-signature</code> header, and reject
            anything older than five minutes.
          </p>
        </div>
      </div>
    </div>
  )
}

function EndpointList({ endpoints }: { endpoints: WebhookEndpointRow[] }) {
  if (!endpoints.length) {
    return (
      <section className="rounded-lg border border-dashed p-8 text-center">
        <Webhook className="mx-auto size-6 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">No endpoints yet</p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Add one to have your accounting tool, CRM or Slack channel told the moment an invoice is
          paid — without anything polling us.
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Your endpoints</h2>
      <ul className="divide-y rounded-lg border">
        {endpoints.map((endpoint) => (
          <EndpointRow key={endpoint.id} row={endpoint} />
        ))}
      </ul>
    </section>
  )
}

function EndpointRow({ row }: { row: WebhookEndpointRow }) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <li className="flex flex-wrap items-start gap-4 p-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <code className="truncate text-sm">{row.url}</code>
          {row.disabled_at ? (
            <Badge variant="outline">Disabled</Badge>
          ) : (
            <Badge>Active</Badge>
          )}
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {row.events.length ? row.events.join(', ') : 'All events'}
        </p>

        {row.disabled_at ? (
          <p className="mt-2 text-xs text-destructive">
            Turned off automatically after {row.failure_count} failed deliveries in a row. Fix the
            receiver, then add it again.
          </p>
        ) : null}

        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
      </div>

      <Dialog>
        <DialogTrigger render={<Button variant="outline" size="sm" />}>Delete</DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this endpoint?</DialogTitle>
            <DialogDescription>
              We&rsquo;ll stop sending events to <code className="text-xs">{row.url}</code>. Any
              deliveries still queued for it are dropped. You can add it again later, but it will
              get a new signing secret.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  const result = await deleteWebhookAction(row.id)
                  if (result?.error) setError(result.error)
                })
              }}
            >
              {isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  )
}

/**
 * The screen that makes "it isn't firing" answerable.
 *
 * Nearly every webhook support question is one of three things: the receiver
 * returned an error, it timed out, or the event type was never subscribed to.
 * Showing the response code and error text next to each attempt lets someone
 * tell those apart without asking us.
 */
function DeliveryLog({ deliveries }: { deliveries: WebhookDeliveryRow[] }) {
  if (!deliveries.length) return null

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium">Recent deliveries</h2>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Event</th>
              <th className="px-4 py-2 text-left font-medium">Status</th>
              <th className="px-4 py-2 text-left font-medium">Attempt</th>
              <th className="px-4 py-2 text-left font-medium">When</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {deliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td className="px-4 py-2">
                  <code className="text-xs">{delivery.event_type}</code>
                </td>
                <td className="px-4 py-2">
                  <DeliveryStatus row={delivery} />
                </td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{delivery.attempt}</td>
                <td className="whitespace-nowrap px-4 py-2 text-xs text-muted-foreground">
                  {new Date(delivery.created_at).toLocaleString('en-IN', {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function DeliveryStatus({ row }: { row: WebhookDeliveryRow }) {
  const label =
    row.status === 'succeeded'
      ? `Delivered${row.response_code ? ` (${row.response_code})` : ''}`
      : row.status === 'pending'
        ? 'Queued'
        : row.status === 'dead'
          ? 'Gave up'
          : 'Failed'

  return (
    <div className="min-w-0">
      <Badge variant={row.status === 'succeeded' ? 'default' : 'outline'}>{label}</Badge>
      {row.last_error ? (
        <p className="mt-1 max-w-md truncate text-[11px] text-muted-foreground" title={row.last_error}>
          {row.last_error}
        </p>
      ) : null}
    </div>
  )
}
