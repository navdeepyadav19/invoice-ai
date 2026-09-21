import { describe, expect, it } from 'vitest'

import {
  customersHref,
  formatBilled,
  formatClientAddress,
  parseCustomerListParams,
  summarizeInvoices,
  toClientRecord,
} from '@/lib/customers'
import { clientSchema } from '@/lib/validators'

describe('parseCustomerListParams', () => {
  it('defaults everything', () => {
    expect(parseCustomerListParams({})).toEqual({ q: '', cursor: null, archived: false })
  })

  it('trims the query and reads the archived flag', () => {
    expect(parseCustomerListParams({ q: '  acme ', archived: '1', cursor: 'abc' })).toEqual({
      q: 'acme',
      cursor: 'abc',
      archived: true,
    })
  })

  it('takes the first value of a repeated param', () => {
    expect(parseCustomerListParams({ q: ['one', 'two'] }).q).toBe('one')
  })

  it('caps an absurdly long query', () => {
    expect(parseCustomerListParams({ q: 'x'.repeat(500) }).q).toHaveLength(100)
  })
})

describe('customersHref', () => {
  it('is the bare path with no params', () => {
    expect(customersHref()).toBe('/customers')
    expect(customersHref({ q: '', archived: false, cursor: null })).toBe('/customers')
  })

  it('encodes set params', () => {
    expect(customersHref({ q: 'a&b', archived: true, cursor: 'c1' })).toBe(
      '/customers?q=a%26b&archived=1&cursor=c1',
    )
  })
})

describe('summarizeInvoices', () => {
  it('counts every invoice but only bills issued ones, per currency', () => {
    const summary = summarizeInvoices([
      { client_id: 'a', status: 'paid', total: 100, currency: 'USD' },
      { client_id: 'a', status: 'open', total: '50.25', currency: 'USD' },
      { client_id: 'a', status: 'open', total: 10, currency: 'EUR' },
      { client_id: 'a', status: 'draft', total: 999, currency: 'USD' },
      { client_id: 'a', status: 'void', total: 999, currency: 'USD' },
      { client_id: 'b', status: 'draft', total: 5, currency: 'USD' },
      { client_id: null, status: 'paid', total: 5, currency: 'USD' },
    ])

    expect(summary.get('a')).toEqual({ count: 5, billed: { USD: 15025, EUR: 1000 } })
    expect(summary.get('b')).toEqual({ count: 1, billed: {} })
    expect(summary.size).toBe(2)
  })
})

describe('formatBilled', () => {
  it('shows a dash for nothing billed', () => {
    expect(formatBilled({})).toBe('—')
  })

  it('joins currencies in a stable order', () => {
    expect(formatBilled({ USD: 150025, EUR: 1000 })).toBe('€10.00 + $1,500.25')
  })
})

describe('toClientRecord', () => {
  it('writes blanks as null so an edit can clear a field', () => {
    const parsed = clientSchema.parse({ name: 'Acme', phone: '', tax_id: '  ', email: '' })
    expect(toClientRecord(parsed)).toEqual({
      name: 'Acme',
      email: null,
      phone: null,
      tax_id: null,
      address_line1: null,
      address_line2: null,
      city: null,
      region: null,
      postal_code: null,
      country_code: null,
    })
  })

  it('sets the country name from the code', () => {
    const parsed = clientSchema.parse({ name: 'Acme', country_code: 'de', city: 'Berlin' })
    expect(toClientRecord(parsed)).toMatchObject({
      country_code: 'DE',
      country: 'Germany',
      city: 'Berlin',
    })
  })
})

describe('formatClientAddress', () => {
  it('joins the non-empty parts', () => {
    expect(
      formatClientAddress({
        address_line1: '1 Main St',
        city: 'Austin',
        region: 'TX',
        postal_code: '73301',
        country_code: 'US',
      }),
    ).toBe('1 Main St, Austin, TX 73301, United States')
  })

  it('is empty when nothing is known', () => {
    expect(formatClientAddress({})).toBe('')
  })
})
