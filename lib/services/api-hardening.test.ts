import { beforeEach, describe, expect, it, vi } from 'vitest'

// The services import the server tree (cookies, PDF renderer, mailer) at
// module load. None of it runs in these tests — the fake client below is the
// only thing a service touches — so the heavy modules are stubbed out.
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ renderInvoicePdf: vi.fn(), pdfFilename: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendInvoiceEmail: vi.fn() }))

import type { AuthContext } from '@/lib/auth/context'
import { ALL_SCOPES } from '@/lib/auth/scopes'
import { encodeCursor } from '@/lib/services/pagination'
import { fromPostgres, isServiceError, ServiceError } from '@/lib/services/errors'
import { serializeInvoice, serializePrice } from '@/lib/api/serialize'
import { problemFromError } from '@/lib/api/problem'
import { emptyClientInput, invoiceWireSchema } from '@/lib/validators'
import { todayUtc } from '@/lib/invoice-status'
import * as clients from '@/lib/services/clients'
import * as invoices from '@/lib/services/invoices'
import * as prices from '@/lib/services/prices'
import * as products from '@/lib/services/products'
import * as webhooks from '@/lib/services/webhooks'

/**
 * A PostgREST query builder that records every call and resolves to `rows`.
 * Enough to assert *what was asked of the database*, which is the point here:
 * the overdue filter has to be in the query, not applied to its result.
 */
function fakeContext(rows: Array<Record<string, unknown>> = []) {
  const calls: Array<[string, ...unknown[]]> = []
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'order', 'limit', 'eq', 'lt', 'gte', 'lte', 'or', 'is', 'ilike', 'in', 'delete']) {
    builder[method] = (...args: unknown[]) => {
      calls.push([method, ...args])
      return builder
    }
  }
  builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  builder.then = (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null })

  const from = vi.fn((table: string) => {
    calls.push(['from', table])
    return builder
  })

  const ctx = {
    userId: 'user-1',
    supabase: { from },
    via: 'api_key',
    scopes: new Set(ALL_SCOPES),
    requestId: 'req_test',
  } as unknown as AuthContext

  return { ctx, calls, from }
}

async function rejection(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise
  } catch (error) {
    if (isServiceError(error)) return error
    throw error
  }
  throw new Error('expected the call to throw')
}

const UUID = '6d3a9f1c-8e2b-4c75-a0d4-1f7e3b9c5a28'

function invoiceRow(n: number) {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    created_at: `2026-09-${String(10 + n).padStart(2, '0')}T00:00:00.000Z`,
    status: 'open',
    due_date: '2026-01-01',
  }
}

describe('status=overdue is filtered in SQL', () => {
  it('asks for open invoices due before today (UTC), not open invoices narrowed afterwards', async () => {
    const { ctx, calls } = fakeContext([invoiceRow(1)])
    await invoices.list(ctx, { status: 'overdue' })

    expect(calls).toContainEqual(['eq', 'status', 'open'])
    expect(calls).toContainEqual(['lt', 'due_date', todayUtc()])
  })

  /**
   * The bug: with limit=2 and three open rows fetched, filtering in JS could
   * return fewer rows than exist and a null cursor. Now the database's answer
   * is the page: limit+1 rows back means a full page plus a next_cursor.
   */
  it('returns full pages and a cursor when more overdue invoices exist', async () => {
    const { ctx, calls } = fakeContext([invoiceRow(3), invoiceRow(2), invoiceRow(1)])
    const page = await invoices.list(ctx, { status: 'overdue', limit: 2 })

    expect(calls).toContainEqual(['limit', 3])
    expect(page.data).toHaveLength(2)
    expect(page.next_cursor).not.toBeNull()
  })

  it('other statuses are a plain equality filter', async () => {
    const { ctx, calls } = fakeContext()
    await invoices.list(ctx, { status: 'paid' })

    expect(calls).toContainEqual(['eq', 'status', 'paid'])
    expect(calls.some(([method]) => method === 'lt')).toBe(false)
  })
})

describe('an invalid cursor is a 422, never page one', () => {
  const bad = ['!!!!', Buffer.from('nope', 'utf8').toString('base64url'), encodeCursor({ createdAt: 'yesterday', id: UUID }), encodeCursor({ createdAt: '2026-09-17T08:30:00.000Z', id: "x),id.gt.(0" })]

  it.each(bad)('rejects %s on every list', async (cursor) => {
    for (const call of [
      (ctx: AuthContext) => invoices.list(ctx, { cursor }),
      (ctx: AuthContext) => clients.list(ctx, { cursor }),
      (ctx: AuthContext) => products.list(ctx, { cursor }),
      (ctx: AuthContext) => prices.list(ctx, { cursor }),
      (ctx: AuthContext) => webhooks.list(ctx, { cursor }),
    ]) {
      const { ctx } = fakeContext()
      const error = await rejection(call(ctx))
      expect(error.code).toBe('validation')
      expect(error.details).toEqual([expect.objectContaining({ path: 'cursor' })])
    }
  })

  it('a cursor from a previous page is applied as a position filter', async () => {
    const { ctx, calls } = fakeContext()
    const createdAt = '2026-09-17T08:30:00.000Z'
    await invoices.list(ctx, { cursor: encodeCursor({ createdAt, id: UUID }) })

    expect(calls).toContainEqual([
      'or',
      `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${UUID})`,
    ])
  })
})

describe('malformed ids are 404 not_found, not a failed uuid cast', () => {
  const bogus = ['nope', 'in_short', '123', "'; drop table invoices; --", 'cus_Nf3kQ8pR2mX7vB1cT9wL4sZ6'.slice(0, 10)]

  it.each(bogus)('%s', async (id) => {
    for (const call of [
      (ctx: AuthContext) => invoices.get(ctx, id),
      (ctx: AuthContext) => clients.get(ctx, id),
      (ctx: AuthContext) => products.get(ctx, id),
      (ctx: AuthContext) => prices.get(ctx, id),
      (ctx: AuthContext) => webhooks.remove(ctx, id),
    ]) {
      const { ctx, from } = fakeContext()
      const error = await rejection(call(ctx))
      expect(error.code).toBe('not_found')
      // Answered from the id's shape alone — the database is never asked.
      expect(from).not.toHaveBeenCalled()
    }
  })

  it('an unknown invoice item id is simply not found', async () => {
    const { ctx, from } = fakeContext()
    expect(await invoices.findItem(ctx, 'garbage')).toBeNull()
    expect(from).not.toHaveBeenCalled()
  })

  it('well-formed ids still reach the database', async () => {
    const { ctx, from } = fakeContext()
    await rejection(invoices.get(ctx, UUID))
    expect(from).toHaveBeenCalledWith('invoices')
  })

  it('Postgres 22P02 (invalid_text_representation) maps to not_found as a backstop', () => {
    const error = fromPostgres({ code: '22P02', message: 'invalid input syntax for type uuid: "nope"' })
    expect(error.code).toBe('not_found')
  })
})

describe('PATCH /invoices/{id} is a partial update', () => {
  const base = {
    client: { ...emptyClientInput(), name: 'Acme' },
    issue_date: '2026-09-22',
    due_date: '2026-10-22',
    currency: 'JPY',
    collection_method: 'send_invoice' as const,
    notes: 'Old notes',
    terms: 'Net 30',
    items: [{ description: '', quantity: 1, unit: 'NOS' as const, discount_percent: 0, price: 'price_Jc5Tn8Wq1Ze6Ra3Ym9Ub2Gs7' }],
  }

  it('without customer or items, keeps the stored customer and lines untouched', async () => {
    const { ctx, from } = fakeContext()
    const merged = await invoices.wireToDraftInput(ctx, invoiceWireSchema.parse({ description: 'New notes' }), base)

    expect(merged.client).toEqual(base.client)
    expect(merged.items).toEqual(base.items)
    expect(merged.notes).toBe('New notes')
    expect(merged.terms).toBe('Net 30')
    expect(from).not.toHaveBeenCalled()
  })

  it('items, when sent, replace the lines — read in the invoice currency’s minor unit', async () => {
    const { ctx } = fakeContext()
    const merged = await invoices.wireToDraftInput(
      ctx,
      invoiceWireSchema.parse({ items: [{ description: 'Workshop', unit_amount: 5000 }] }),
      base,
    )
    expect(merged.items).toHaveLength(1)
    // ¥5000 is 5000 on the wire, and a 5000 rate in the draft — not 50.
    expect(merged.items[0].rate).toBe(5000)
  })
})

describe('money on the wire uses the currency’s own minor unit', () => {
  it('a ¥5000 price is 5000, a $25.00 price is 2500', () => {
    const price = { public_id: 'price_x', unit_amount: '5000.00', currency: 'JPY', type: 'one_time', tax_rate: '0' }
    expect(serializePrice(price as never).unit_amount).toBe(5000)
    expect(serializePrice({ ...price, unit_amount: '25.00', currency: 'USD' } as never).unit_amount).toBe(2500)
  })

  it('a JPY invoice and its lines are in whole yen', () => {
    const invoice = {
      public_id: 'in_x', status: 'draft', due_date: null, currency: 'JPY',
      subtotal: '5000.00', discount_total: '0.00', taxable_total: '5000.00', tax_total: '500.00', round_off: '0.00', total: '5500.00',
    }
    const item = { public_id: 'ii_x', rate: '5000.00', quantity: '1', discount_percent: '0', tax_rate: '10', taxable_value: '5000.00', tax_amount: '500.00', line_total: '5500.00' }
    const wire = serializeInvoice(invoice as never, [item as never])

    expect(wire.total).toBe(5500)
    expect(wire.tax).toBe(500)
    expect(wire.lines?.data[0]).toMatchObject({ unit_amount: 5000, amount: 5500, tax_amount: 500 })
  })
})

describe('idempotency mismatch has its own code', () => {
  it('is a 422 with code idempotency_mismatch', async () => {
    const response = problemFromError(new ServiceError('idempotency_mismatch', 'reused'), 'req_1')
    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({ code: 'idempotency_mismatch', type: expect.stringContaining('idempotency-mismatch') })
  })
})

describe('invoice events are paginated', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pages with limit + 1 and returns next_cursor', async () => {
    const event = (n: number) => ({ id: invoiceRow(n).id, created_at: invoiceRow(n).created_at, invoice_id: UUID, type: 'created' })
    // The first row doubles as the invoice `load` finds; the list is the rest.
    const { ctx, calls } = fakeContext([{ ...invoiceRow(9), id: UUID }, event(2), event(1)])
    const page = await invoices.events(ctx, UUID, { limit: 2 })

    expect(calls).toContainEqual(['limit', 3])
    expect(page.data).toHaveLength(2)
    expect(page.next_cursor).not.toBeNull()
  })
})
