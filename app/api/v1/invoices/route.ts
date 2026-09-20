import { json, readJson, withApi } from '@/lib/api/handler'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'
import type { InvoiceStatus } from '@/lib/database.types'
import type { InvoiceInput } from '@/lib/validators'

const STATUSES: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue', 'cancelled']

/**
 * GET /api/v1/invoices?status=&client_id=&from=&to=&cursor=&limit=
 *
 * `status=overdue` works even though no row is ever stored as overdue — the
 * service asks for issued invoices and applies deriveStatus() afterwards.
 */
export const GET = withApi({ scope: 'invoices:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const status = params.get('status')

  const page = await invoices.list(ctx, {
    status: status && STATUSES.includes(status as InvoiceStatus) ? (status as InvoiceStatus) : undefined,
    clientId: params.get('client_id') ?? undefined,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })

  return json({ data: page.data.map((row) => serializeInvoice(row)), next_cursor: page.next_cursor })
})

/**
 * POST /api/v1/invoices — create a draft.
 *
 * Idempotency is `required` here even though a draft holds no invoice number.
 * A retried create makes a second draft that looks identical to the first, and
 * the caller has no way to tell which one their next `issue` call should target
 * — so they issue one and leave the other, or worse, issue both.
 */
export const POST = withApi(
  { scope: 'invoices:write', idempotent: 'required' },
  async (ctx, request) => {
    const body = (await readJson(request)) as InvoiceInput
    const { invoice, items } = await invoices.createDraft(ctx, body)

    return json({ data: serializeInvoice(invoice, items) }, { status: 201 })
  },
)
