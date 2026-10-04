import { describe, expect, it } from 'vitest'

import { parseTimestamp, parseTimestamptz, pgTypes } from './parsers'

describe('parseTimestamptz', () => {
  it('turns Postgres text into the ISO shape PostgREST returned', () => {
    expect(parseTimestamptz('2026-10-03 16:23:51.123456+00')).toBe('2026-10-03T16:23:51.123456+00:00')
  })

  // The cursor round-trips this value; truncating to milliseconds would make
  // "rows after the cursor" re-include the row the cursor came from.
  it('keeps microseconds', () => {
    expect(parseTimestamptz('2026-01-01 00:00:00.000001+00')).toMatch(/\.000001\+00:00$/)
  })

  it('leaves an offset that already has minutes alone', () => {
    expect(parseTimestamptz('2026-10-03 22:00:00+05:30')).toBe('2026-10-03T22:00:00+05:30')
  })

  it('handles whole seconds', () => {
    expect(parseTimestamptz('2026-10-03 16:23:51+00')).toBe('2026-10-03T16:23:51+00:00')
  })

  it('parses back to the same instant', () => {
    expect(Date.parse(parseTimestamptz('2026-10-03 16:23:51.5+00'))).toBe(Date.UTC(2026, 9, 3, 16, 23, 51, 500))
  })
})

describe('parseTimestamp', () => {
  it('only swaps the separator', () => {
    expect(parseTimestamp('2026-10-03 16:23:51.123456')).toBe('2026-10-03T16:23:51.123456')
  })
})

describe('pgTypes', () => {
  const parse = (oid: number, value: string) => (pgTypes.getTypeParser(oid, 'text') as (v: string) => unknown)(value)

  it('returns numeric money as a number', () => {
    expect(parse(1700, '1234.50')).toBe(1234.5)
  })

  it('returns count(*) (int8) as a number', () => {
    expect(parse(20, '42')).toBe(42)
  })

  // pg's default turns a date into local midnight, which shifts a day west of UTC.
  it('leaves dates as YYYY-MM-DD strings', () => {
    expect(parse(1082, '2026-03-31')).toBe('2026-03-31')
  })

  it('falls back to pg defaults for everything else', () => {
    expect(parse(16, 't')).toBe(true)
    expect(parse(23, '7')).toBe(7)
  })
})
