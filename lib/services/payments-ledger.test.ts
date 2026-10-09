import { describe, expect, it, vi } from 'vitest'

// Same stubs as api-hardening.test.ts: services import the server tree at load.
vi.mock('@/lib/db', () => ({ userDb: vi.fn(), anonDb: vi.fn() }))
vi.mock('@/lib/queries', () => ({ getCurrentUser: vi.fn() }))
vi.mock('@/lib/pdf', () => ({ renderInvoicePdf: vi.fn(), pdfFilename: vi.fn() }))
vi.mock('@/lib/email', () => ({ sendInvoiceEmail: vi.fn() }))

import type { AuthContext } from '@/lib/auth/context'
import { ALL_SCOPES } from '@/lib/auth/scopes'
import { fakeDb, type FakeResponder } from '@/lib/db/testing'
import { isServiceError, type ServiceError } from '@/lib/services/errors'
import { serializeInvoice } from '@/lib/api/serialize'
import * as invoices from '@/lib/services/invoices'

/**
 * Manual payments go through the 0017 ledger (record_manual_payment). The SQL
 * itself is exercised against a real database by scripts/check-payments-ledger.ts;
 * these tests pin the service's own rules: validation before any write, the
 * amount conversion to major units, and the void guard.
 */

function fakeContext(respond?: FakeResponder) {
  const db = fakeDb(respond)
  const ctx = { userId: 'user-1', db, via: 'api_key', scopes: new Set(ALL_SCOPES), requestId: 'req_test' } as unknown as AuthContext
  return { ctx, queries: db.queries }
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

const ID = '00000000-0000-4000-8000-000000000001'

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: ID, public_id: 'in_test', status: 'open', currency: 'USD', due_date: null,
    total: 1000, amount_paid: 0, amount_credited: 0,
    subtotal: 1000, discount_total: 0, taxable_total: 1000, tax_total: 0, round_off: 0,
    ...overrides,
  }
}

/** Answers invoice loads with `row`, items with nothing, and the ledger call with a result. */
function responder(row: Record<string, unknown>) {
  return (query: { sql: string }) => {
    if (query.sql.includes('from "invoices"')) return [row]
    if (query.sql.includes('from "invoice_items"')) return []
    if (query.sql.includes('record_manual_payment')) return [{ result: { payment_id: 'p', public_id: 'pay_1', amount_applied: 400, needs_attention: null, invoice_status: 'open', replayed: false } }]
    return []
  }
}

describe('pay(): manual payments on the ledger', () => {
  it('converts amount from minor units and calls record_manual_payment with it', async () => {
    const { ctx, queries } = fakeContext(responder(invoice()))
    await invoices.pay(ctx, ID, { amountMinor: 40000, reference: 'ACH 1' })

    const call = queries.find((q) => q.sql.includes('record_manual_payment'))!
    expect(call).toBeDefined()
    expect(call.parameters[1]).toBe(400) // $400.00 in major units
    expect(call.parameters[3]).toBe('ACH 1')
  })

  it('passes a null amount when none is given (pay the whole balance)', async () => {
    const { ctx, queries } = fakeContext(responder(invoice()))
    await invoices.pay(ctx, ID, {})
    expect(queries.find((q) => q.sql.includes('record_manual_payment'))!.parameters[1]).toBeNull()
  })

  it('rejects a non-integer or non-positive amount before touching the database', async () => {
    for (const amountMinor of [0, -5, 12.5]) {
      const { ctx, queries } = fakeContext(responder(invoice()))
      const error = await rejection(invoices.pay(ctx, ID, { amountMinor }))
      expect(error.code).toBe('validation')
      expect(queries.some((q) => q.sql.includes('record_manual_payment'))).toBe(false)
    }
  })

  it('rejects an amount above the remaining balance with a 422 on `amount`', async () => {
    const { ctx } = fakeContext(responder(invoice({ amount_paid: 900 })))
    const error = await rejection(invoices.pay(ctx, ID, { amountMinor: 20000 }))
    expect(error.code).toBe('validation')
    expect(error.details?.[0]?.path).toBe('amount')
  })

  it('refuses drafts, paid and void invoices with invalid_state', async () => {
    for (const status of ['draft', 'paid', 'void']) {
      const { ctx } = fakeContext(responder(invoice({ status })))
      expect((await rejection(invoices.pay(ctx, ID, {}))).code).toBe('invalid_state')
    }
  })
})

describe('voidInvoice(): money must be refunded first', () => {
  it('refuses to void an invoice that holds payments', async () => {
    const { ctx, queries } = fakeContext(responder(invoice({ amount_paid: 250 })))
    const error = await rejection(invoices.voidInvoice(ctx, ID, { reason: 'Wrong client' }))
    expect(error.code).toBe('invalid_state')
    expect(error.message).toMatch(/Refund/)
    expect(queries.some((q) => q.sql.startsWith('update "invoices"'))).toBe(false)
  })
})

describe('serializeInvoice(): balance fields', () => {
  const base = { public_id: 'in_x', due_date: null, currency: 'USD', subtotal: '1000', discount_total: '0', taxable_total: '1000', tax_total: '0', round_off: '0', total: '1000' }

  it('reports a partial payment: open, amount_paid and amount_due = remaining', () => {
    const out = serializeInvoice({ ...base, status: 'open', amount_paid: '400', amount_credited: '0' } as never)
    expect([out.amount_paid, out.amount_remaining, out.amount_due]).toEqual([40000, 60000, 60000])
  })

  it('counts credits against the balance and owes nothing once paid', () => {
    const out = serializeInvoice({ ...base, status: 'paid', amount_paid: '0', amount_credited: '1000' } as never)
    expect([out.amount_credited, out.amount_remaining, out.amount_due]).toEqual([100000, 0, 0])
  })

  it('treats rows without ledger columns (older reads) as nothing paid', () => {
    const out = serializeInvoice({ ...base, status: 'open' } as never)
    expect([out.amount_paid, out.amount_remaining]).toEqual([0, 100000])
  })
})
