import { describe, expect, it } from 'vitest'

import { isServiceError } from './errors'
import { clampLimit, decodeCursor, encodeCursor, parseCursor, toPage } from './pagination'

describe('cursor encoding', () => {
  it('round-trips a position', () => {
    const position = { createdAt: '2026-09-17T08:30:00.000Z', id: 'a1b2c3d4-0000-0000-0000-000000000001' }
    expect(decodeCursor(encodeCursor(position))).toEqual(position)
  })

  /**
   * An id is a uuid and contains hyphens, and a timestamp contains colons — but
   * neither contains '|'. Splitting on the LAST separator is still the safer
   * choice: if a future key ever includes one, the id half stays intact.
   */
  it('splits on the last separator, not the first', () => {
    const position = { createdAt: '2026-09-17T08:30:00.000Z', id: 'weird|id' }
    const decoded = decodeCursor(encodeCursor(position))
    expect(decoded?.id).toBe('id')
    expect(decoded?.createdAt).toBe('2026-09-17T08:30:00.000Z|weird')
  })

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['not base64', '!!!!'],
    ['base64 without a separator', Buffer.from('nope', 'utf8').toString('base64url')],
    ['missing the id half', Buffer.from('2026-09-17|', 'utf8').toString('base64url')],
  ])('returns null for a cursor that is %s', (_label, cursor) => {
    // Returning null means "start from the beginning" is never silently
    // substituted for a malformed cursor — the caller's loop would otherwise
    // run forever without noticing.
    expect(decodeCursor(cursor)).toBeNull()
  })

  it('is opaque enough that nobody is tempted to build one by hand', () => {
    const encoded = encodeCursor({ createdAt: '2026-09-17T08:30:00.000Z', id: 'x' })
    expect(encoded).not.toContain('2026')
    expect(encoded).not.toContain('|')
  })
})

describe('parseCursor (what the list endpoints use)', () => {
  const valid = { createdAt: '2026-09-17T08:30:00.000Z', id: 'a1b2c3d4-0000-4000-8000-000000000001' }

  it('returns null when no cursor was sent — that really is page one', () => {
    expect(parseCursor(undefined)).toBeNull()
    expect(parseCursor(null)).toBeNull()
    expect(parseCursor('')).toBeNull()
  })

  it('accepts a cursor this API issued', () => {
    expect(parseCursor(encodeCursor(valid))).toEqual(valid)
  })

  it.each([
    ['garbage', '!!!!'],
    ['no separator', Buffer.from('nope', 'utf8').toString('base64url')],
    ['a non-uuid id', encodeCursor({ ...valid, id: 'x' })],
    ['a non-timestamp', encodeCursor({ ...valid, createdAt: 'soon' })],
    ['a filter injection', encodeCursor({ ...valid, id: `${valid.id}),id.gt.(0` })],
  ])('throws a 422 on cursor for %s', (_label, cursor) => {
    try {
      parseCursor(cursor)
      expect.unreachable()
    } catch (error) {
      expect(isServiceError(error) && error.code).toBe('validation')
      expect(isServiceError(error) && error.details).toEqual([expect.objectContaining({ path: 'cursor' })])
    }
  })
})

describe('page helpers', () => {
  it('clamps limit to 1–100, default 25', () => {
    expect(clampLimit(undefined)).toBe(25)
    expect(clampLimit(Number.NaN)).toBe(25)
    expect(clampLimit(0)).toBe(25)
    expect(clampLimit(-3)).toBe(1)
    expect(clampLimit(500)).toBe(100)
    expect(clampLimit(10.7)).toBe(10)
  })

  it('a limit+1 fetch becomes a page and a cursor at the last row', () => {
    const rows = [3, 2, 1].map((n) => ({ id: `id-${n}`, created_at: `2026-09-1${n}T00:00:00Z` }))
    const page = toPage(rows, 2)
    expect(page.data).toHaveLength(2)
    expect(decodeCursor(page.next_cursor)).toEqual({ createdAt: '2026-09-12T00:00:00Z', id: 'id-2' })
    expect(toPage(rows, 3).next_cursor).toBeNull()
  })
})
