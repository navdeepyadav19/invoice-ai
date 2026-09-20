/**
 * The event catalogue, in a module with no server-only imports.
 *
 * This lives apart from lib/services/webhooks.ts on purpose: that file reaches
 * AuthContext → the Supabase server client → `next/headers`, so a client
 * component importing the list from there drags the whole server tree into the
 * browser bundle and the build fails. A plain constant has no such dependency.
 */

export const WEBHOOK_EVENTS = [
  'invoice.created',
  'invoice.updated',
  'invoice.issued',
  'invoice.emailed',
  'invoice.email_failed',
  'invoice.viewed',
  'invoice.downloaded',
  'invoice.paid',
  'invoice.cancelled',
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
  'invoice.issued': 'An invoice got its GST number',
  'invoice.emailed': 'An invoice was emailed to a client',
  'invoice.email_failed': 'An invoice email bounced or failed',
  'invoice.viewed': 'A client opened the invoice link',
  'invoice.downloaded': 'A client downloaded the PDF',
  'invoice.paid': 'An invoice was marked paid',
  'invoice.cancelled': 'An invoice was cancelled',
}
