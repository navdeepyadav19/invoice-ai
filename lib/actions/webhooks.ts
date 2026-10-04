'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import * as webhooks from '@/lib/services/webhooks'
import { toActionError } from '@/lib/actions/to-action-error'
import { withValues, type FormValues } from '@/lib/form-state'
import type { WebhookDeliveryRow, WebhookEndpointRow } from '@/lib/database.types'

/**
 * Webhook management from the dashboard.
 *
 * The API can do this too (`webhooks:manage`), but requiring an API key to set
 * up webhooks is a chicken-and-egg problem for anyone who isn't a developer:
 * "get notified when an invoice is paid" is a product feature, not an
 * integration task, and it shouldn't need a curl command.
 */

export interface CreateWebhookState {
  error?: string
  fieldErrors?: Record<string, string>
  /** Returned once. Never shown again. */
  secret?: string
  url?: string
  /** The submitted URL and events, echoed back on failure. */
  values?: FormValues
}

export async function createWebhookAction(formData: FormData): Promise<CreateWebhookState> {
  await requireUser()

  const url = String(formData.get('url') ?? '').trim()
  const events = formData.getAll('events').map(String)

  if (!url) {
    return withValues(
      { error: 'Enter the URL to send events to.', fieldErrors: { url: 'Required' } },
      formData,
    )
  }

  try {
    const ctx = await contextFromSession()
    const endpoint = await webhooks.create(ctx, { url, events })

    revalidatePath('/settings/webhooks')

    return { secret: endpoint.secret, url: endpoint.url }
  } catch (cause) {
    return withValues(toActionError(cause), formData)
  }
}

export async function deleteWebhookAction(id: string): Promise<{ error?: string }> {
  await requireUser()

  try {
    await webhooks.remove(await contextFromSession(), id)
  } catch (cause) {
    return toActionError(cause)
  }

  revalidatePath('/settings/webhooks')
  return {}
}

/**
 * Everything but the signing secret. This feeds a client component, so any
 * column selected here ends up in the page's RSC payload — and the secret is
 * shown exactly once, at creation, by design.
 */
export type WebhookEndpointListRow = Omit<WebhookEndpointRow, 'secret'>

export async function listWebhookEndpoints(): Promise<WebhookEndpointListRow[]> {
  const ctx = await contextFromSession()

  const rows = await ctx.db
    .selectFrom('webhook_endpoints')
    .select(['id', 'owner_id', 'url', 'events', 'active', 'failure_count', 'disabled_at', 'created_at'])
    .orderBy('created_at', 'desc')
    .execute()

  return rows as WebhookEndpointListRow[]
}

/**
 * Recent delivery attempts.
 *
 * This is the screen that makes webhooks debuggable. "It isn't firing" is
 * almost always one of: the endpoint 500s, it times out, or the event type was
 * never subscribed to — and without the response code and error text sitting
 * next to each attempt, the only way to tell them apart is to ask us.
 */
export async function listRecentDeliveries(limit = 30): Promise<WebhookDeliveryRow[]> {
  const ctx = await contextFromSession()
  // Exported from a 'use server' module, so `limit` can arrive from a client.
  limit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 30

  const rows = await ctx.db
    .selectFrom('webhook_deliveries')
    .selectAll()
    .orderBy('created_at', 'desc')
    .limit(limit)
    .execute()

  return rows as WebhookDeliveryRow[]
}
