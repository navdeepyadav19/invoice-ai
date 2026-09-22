import { json, withApi } from '@/lib/api/handler'
import { serializeEvent } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * GET /api/v1/invoices/{id}/events?cursor=&limit=
 *
 * The history of one invoice: created, issued, emailed, viewed, downloaded,
 * paid, cancelled. `viewed` and `downloaded` come from the public share link
 * and are written by the database, so they appear here without ever passing
 * through the API — which is how an integrator can tell that a client actually
 * opened the invoice.
 *
 * Event names follow Stripe: `finalized` is stored and the API says
 * `invoice.finalized`; `voided` becomes `invoice.voided`.
 */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, request, route) => {
  const { id } = await route.params
  const params = new URL(request.url).searchParams
  const page = await invoices.events(ctx, id, {
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })

  return json({ data: page.data.map(serializeEvent), next_cursor: page.next_cursor })
})
