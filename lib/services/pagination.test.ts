import { describe, expect, it } from 'vitest'

import { decodeCursor, encodeCursor } from './pagination'

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
