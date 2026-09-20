import { json, withApi } from '@/lib/api/handler'
import { serializeEvent } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * GET /api/v1/invoices/{id}/events
 *
 * The history of one invoice: created, issued, emailed, viewed, downloaded,
 * paid, cancelled. `viewed` and `downloaded` come from the public share link
 * and are written by the database, so they appear here without ever passing
 * through the API — which is how an integrator can tell that a client actually
 * opened the invoice.
 *
 * Event names are translated at the edge: the stored enum says `sent`, the API
 * says `invoice.issued`.
 */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, _request, route) => {
  const { id } = await route.params
  const events = await invoices.events(ctx, id)

  return json({ data: events.map(serializeEvent) })
})
