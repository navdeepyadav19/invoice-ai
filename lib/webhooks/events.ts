import type { serializeInvoice } from '@/lib/api/serialize'

/**
 * The event catalogue, in a module with no server-only imports.
 *
 * This lives apart from lib/services/webhooks.ts on purpose: that file reaches
 * AuthContext → the database pool and Neon Auth → `next/headers`, so a client
 * component importing the list from there drags the whole server tree into the
 * browser bundle and the build fails. A plain constant has no such dependency.
 */

export const WEBHOOK_EVENTS = [
  'invoice.created',
  'invoice.updated',
  'invoice.finalized',
  'invoice.emailed',
  'invoice.email_failed',
  'invoice.viewed',
  'invoice.downloaded',
  'invoice.paid',
  'invoice.voided',
  'invoice.payment_succeeded',
  'invoice.payment_failed',
  'invoice.refunded',
  'invoice.credited',
  'invoice.dispute_opened',
  'invoice.dispute_closed',
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

/**
 * `invoice.email_failed` means nothing to a business owner deciding what to
 * subscribe to. The machine name still shows underneath for whoever is writing
 * the receiver.
 */
export const WEBHOOK_EVENT_LABELS: Record<WebhookEvent, string> = {
  'invoice.created': 'A draft was created',
  'invoice.updated': 'A draft was edited',
  'invoice.finalized': 'An invoice was finalized and opened',
  'invoice.emailed': 'An invoice was emailed to a client',
  'invoice.email_failed': 'The email provider rejected an invoice email',
  'invoice.viewed': 'A client opened the invoice link',
  'invoice.downloaded': 'A client downloaded the PDF',
  'invoice.paid': 'An invoice was paid in full',
  'invoice.voided': 'An invoice was voided',
  'invoice.payment_succeeded': 'A payment was received (full or partial)',
  'invoice.payment_failed': 'An online payment attempt failed',
  'invoice.refunded': 'A payment was refunded',
  'invoice.credited': 'An amount was credited, so the client no longer owes it',
  'invoice.dispute_opened': 'A client disputed a card payment',
  'invoice.dispute_closed': 'A payment dispute was resolved',
}

/**
 * The body POSTed to a webhook endpoint (payload v2, migration 0014).
 *
 * Stripe-style envelope around the same `Invoice` the REST API returns —
 * public ids, integer minor units, derived `overdue` — minus `lines`
 * (GET /invoices/{id} has them). `id` is the event id; the `webhook-id`
 * header is the delivery id, which is what to deduplicate on.
 */
export interface WebhookEventPayload {
  id: string
  type: WebhookEvent
  created_at: string
  data: { object: WebhookInvoiceObject }
}

export type WebhookInvoiceObject = Omit<ReturnType<typeof serializeInvoice>, 'lines'>
