import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { serializeInvoice } from '@/lib/api/serialize'
import { currencyDecimals } from '@/lib/currency'

/**
 * The webhook payload is built in SQL (0014's trigger) and the REST Invoice in
 * TypeScript (serializeInvoice). Nothing runs the SQL in CI, so this reads the
 * migration and checks the two can't drift: same fields, same currency table.
 */
const SQL = readFileSync(resolve(import.meta.dirname, '../../supabase/migrations/0014_webhook_payload_v2.sql'), 'utf8')

function sqlInvoiceKeys(): string[] {
  const start = SQL.lastIndexOf('jsonb_build_object(', SQL.indexOf("'id', i.public_id"))
  const end = SQL.indexOf(') as object', start)
  const body = SQL.slice(start, end)
  // Keys sit at the start of a line inside the jsonb_build_object call.
  return [...body.matchAll(/^\s+'([a-z_]+)',/gm)].map((m) => m[1])
}

function sqlCurrencies(decimals: 0 | 3): string[] {
  const marker = decimals === 0 ? 'then 0' : 'then 3'
  const end = SQL.indexOf(marker)
  const start = SQL.lastIndexOf('when upper(p_currency) in (', end)
  return [...SQL.slice(start, end).matchAll(/'([A-Z]{3})'/g)].map((m) => m[1])
}

describe('webhook payload v2 (0014) matches the REST Invoice', () => {
  it('has exactly the fields serializeInvoice returns, minus lines', () => {
    const row = {
      public_id: 'in_x', status: 'open', due_date: null, currency: 'USD',
      subtotal: '0', discount_total: '0', taxable_total: '0', tax_total: '0', round_off: '0', total: '0',
    }
    const restKeys = Object.keys(serializeInvoice(row as never)).sort()

    expect(sqlInvoiceKeys().sort()).toEqual(restKeys)
  })

  it('uses the same currency table as lib/currency.ts', () => {
    const zero = sqlCurrencies(0)
    const three = sqlCurrencies(3)

    expect(zero).toContain('JPY')
    expect(three).toContain('KWD')
    for (const code of zero) expect(currencyDecimals(code)).toBe(0)
    for (const code of three) expect(currencyDecimals(code)).toBe(3)
    // And nothing the TS table knows is missing from the SQL one.
    for (const code of ['BIF', 'CLP', 'JPY', 'KRW', 'VND', 'XOF', 'BHD', 'JOD', 'OMR', 'TND']) {
      expect([...zero, ...three]).toContain(code)
    }
  })

  it('keeps the Stripe-style envelope', () => {
    expect(SQL).toMatch(/'id', new\.id,\s+'type', v_event_name,\s+'created_at', new\.created_at,\s+'data', jsonb_build_object\('object', inv\.object\)/)
  })

  it('replaces the function in place, leaving 0011’s trigger bound to it', () => {
    expect(SQL).toContain('create or replace function public.enqueue_webhook_deliveries()')
    expect(SQL).not.toMatch(/drop (trigger|function)/i)
  })
})
