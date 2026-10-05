import { json, readJson, withApi } from '@/lib/api/handler'
import { createInvoice, listInvoices } from '@/lib/operations/invoices'

/**
 * GET /api/v1/invoices?status=&customer=&from=&to=&cursor=&limit=
 *
 * `status=overdue` works even though no row is ever stored as overdue — the
 * service filters for open invoices whose due_date is before today (UTC).
 * `customer` accepts a `cus_…` id or UUID.
 */
export const GET = withApi({ scope: 'invoices:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams

  return json(
    await listInvoices(ctx, {
      status: params.get('status'),
      customer: params.get('customer'),
      from: params.get('from'),
      to: params.get('to'),
      cursor: params.get('cursor'),
      limit: params.get('limit') ? Number(params.get('limit')) : undefined,
    }),
  )
})

/**
 * POST /api/v1/invoices — create a draft.
 *
 * Idempotency is `required` even though a draft holds no invoice number.
 * A retried create makes a second draft that looks identical to the first, and
 * the caller has no way to tell which one their next `finalize` call should
 * target — so they finalize one and leave the other, or worse, finalize both.
 */
export const POST = withApi(
  { scope: 'invoices:write', idempotent: 'required' },
  async (ctx, request) => {
    return json(await createInvoice(ctx, await readJson(request)), { status: 201 })
  },
)
