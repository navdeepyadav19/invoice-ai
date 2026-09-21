'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import * as webhooks from '@/lib/services/webhooks'
import { toActionError } from '@/lib/actions/to-action-error'
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
}

export async function createWebhookAction(formData: FormData): Promise<CreateWebhookState> {
  await requireUser()

  const url = String(formData.get('url') ?? '').trim()
  const events = formData.getAll('events').map(String)

  if (!url) {
    return { error: 'Enter the URL to send events to.', fieldErrors: { url: 'Required' } }
  }

  try {
    const ctx = await contextFromSession()
    const endpoint = await webhooks.create(ctx, { url, events })

    revalidatePath('/settings/webhooks')

    return { secret: endpoint.secret, url: endpoint.url }
  } catch (cause) {
    return toActionError(cause)
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

export async function listWebhookEndpoints(): Promise<WebhookEndpointRow[]> {
  const ctx = await contextFromSession()

  const { data } = await ctx.supabase
    .from('webhook_endpoints')
    .select('*')
    .order('created_at', { ascending: false })

  return (data ?? []) as WebhookEndpointRow[]
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

  const { data } = await ctx.supabase
    .from('webhook_deliveries')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as WebhookDeliveryRow[]
}
