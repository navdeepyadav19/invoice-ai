import type { Metadata } from 'next'
import { AlertTriangle } from 'lucide-react'

import { WebhooksManager } from '@/components/settings/webhooks-manager'
import { listRecentDeliveries, listWebhookEndpoints } from '@/lib/actions/webhooks'
import { webhookSetupStatus } from '@/lib/api/setup-status'
import { getCurrentUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'Webhooks' }

export default async function WebhooksPage() {
  const user = await getCurrentUser()
  const isGuest = Boolean(user?.is_anonymous)
  const setup = webhookSetupStatus()

  const [endpoints, deliveries] = isGuest
    ? [[], []]
    : await Promise.all([listWebhookEndpoints(), listRecentDeliveries()])

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-lg font-medium">Webhooks</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Have another system told the moment something happens, instead of it asking us over and
          over.
        </p>
      </div>

      {!setup.ready ? (
        <div className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-4">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium">Deliveries are paused</p>
              <p className="mt-1 text-xs text-muted-foreground">{setup.reason}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Nothing is lost — events are still being recorded and will be sent once this is
                fixed.
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {isGuest ? (
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          Guest accounts can&rsquo;t register webhooks. Add an email and password first.
        </p>
      ) : (
        <WebhooksManager endpoints={endpoints} deliveries={deliveries} />
      )}

      <section className="space-y-3 border-t pt-8">
        <h3 className="text-sm font-medium">What we send</h3>
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 text-xs">
          {`POST https://your-system.example/hooks/invoice-ai
webhook-id:        01J9Z8K3M4N5P6Q7R8S9T0
webhook-timestamp: 1789371234
webhook-signature: v1,K5s2f...

{
  "type": "invoice.paid",
  "created_at": "2026-09-17T09:12:44.000Z",
  "data": {
    "invoice_id": "7f3c...",
    "invoice_number": "INV/26-27/0042",
    "status": "paid",
    "total_paise": 2950000,
    "currency": "INR"
  }
}`}
        </pre>
        <p className="text-xs text-muted-foreground">
          Delivery is at-least-once, so deduplicate on{' '}
          <code className="text-[11px]">webhook-id</code>. Failed attempts retry at 1m, 5m, 30m, 2h,
          8h and 24h before being given up on.
        </p>
      </section>
    </div>
  )
}
