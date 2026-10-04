import { describe, expect, it, vi } from 'vitest'

import { fromPostgres } from './errors'

/**
 * A ServiceError's message is returned to API callers as `detail` and shown in
 * forms, so a database's own wording must never pass through it.
 */
describe('fromPostgres never echoes database internals', () => {
  it.each([
    ['an unknown SQLSTATE', { code: '42501', message: 'permission denied for table invoices' }],
    ['a driver error', { message: 'getaddrinfo ENOTFOUND ep-secret-host.neon.tech' }],
    ['unique violation', { code: '23505', message: 'duplicate key value violates unique constraint "api_keys_prefix_key"' }],
    ['check violation', { code: '23514', message: 'new row for relation "businesses" violates check constraint' }],
    ['FK violation', { code: '23503', message: 'insert or update on table "invoice_items" violates foreign key constraint' }],
  ])('%s', (_label, error) => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const mapped = fromPostgres(error)
    expect(mapped.message).not.toContain(error.message)
    expect(mapped.message).not.toMatch(/relation|constraint|table|neon|permission/i)
  })

  it('keeps our own P0001 messages, which are written for people', () => {
    expect(fromPostgres({ code: 'P0001', message: 'invalid_state' }).message).toBe('invalid_state')
  })

  it('maps a foreign-key violation to validation, not a 502', () => {
    expect(fromPostgres({ code: '23503', message: 'x' }).code).toBe('validation')
  })
})
