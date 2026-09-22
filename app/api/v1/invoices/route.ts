import { json, readJson, withApi } from '@/lib/api/handler'
import { parseWire } from '@/lib/api/validate'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'
import { get as getClient } from '@/lib/services/clients'
import type { InvoiceStatus } from '@/lib/database.types'
import { invoiceCreateWireSchema } from '@/lib/validators'

const STATUSES: InvoiceStatus[] = ['draft', 'open', 'paid', 'overdue', 'void']

/**
 * GET /api/v1/invoices?status=&customer=&from=&to=&cursor=&limit=
 *
 * `status=overdue` works even though no row is ever stored as overdue — the
 * service filters for open invoices whose due_date is before today (UTC).
 * `customer` accepts a `cus_…` id or UUID.
 */
export const GET = withApi({ scope: 'invoices:read' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const status = params.get('status')
  const customer = params.get('customer')

  let clientId: string | undefined
  if (customer) {
    clientId = (await getClient(ctx, customer)).id
  }

  const page = await invoices.list(ctx, {
    status: status && STATUSES.includes(status as InvoiceStatus) ? (status as InvoiceStatus) : undefined,
    clientId,
    from: params.get('from') ?? undefined,
    to: params.get('to') ?? undefined,
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })

  const customers = await invoices.customerMap(
    ctx,
    page.data.map((row) => row.client_id),
  )

  return json({
    data: page.data.map((row) =>
      serializeInvoice(row, undefined, { customerPublicId: customers.get(row.client_id ?? '') ?? null }),
    ),
    next_cursor: page.next_cursor,
  })
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
    const wire = parseWire(invoiceCreateWireSchema, (await readJson(request)) as unknown)
    // `customer` links the saved row; without it the draft would get a copy.
    const { invoice, items } = await invoices.createDraft(ctx, await invoices.wireToDraftInput(ctx, wire), {
      customer: wire.customer,
    })
    const refs = await invoices.refsForInvoice(ctx, invoice, items)

    return json({ data: serializeInvoice(invoice, items, refs) }, { status: 201 })
  },
)
