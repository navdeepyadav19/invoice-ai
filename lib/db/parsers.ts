import { types } from 'pg'

/**
 * How Postgres values become JavaScript values.
 *
 * The app was built against PostgREST, whose JSON shapes are now part of the
 * public API (lib/api/serialize.ts echoes created_at verbatim) and of the
 * pagination cursor. node-postgres's defaults differ in ways that would break
 * both, so the shapes are pinned here:
 *
 *   timestamptz  pg: Date (millisecond precision)   →  ISO string, microseconds kept
 *   timestamp    pg: Date in local time             →  ISO string without zone
 *   date         pg: Date at local midnight          →  'YYYY-MM-DD', untouched
 *   numeric      pg: string                          →  number (money is numeric(14,2))
 *   int8         pg: string                          →  number (count(*) is int8)
 *
 * The cursor is the reason microseconds matter: it round-trips created_at, and
 * a Date would truncate 12:00:00.123456 to .123 — after which "rows strictly
 * after the cursor" silently re-includes the row it came from.
 */

const OID = {
  int8: 20,
  numeric: 1700,
  date: 1082,
  timestamp: 1114,
  timestamptz: 1184,
} as const

/** '2026-10-03 16:23:51.123456+00' → '2026-10-03T16:23:51.123456+00:00' */
export function parseTimestamptz(value: string): string {
  return value.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
}

/** '2026-10-03 16:23:51.123456' → '2026-10-03T16:23:51.123456' */
export function parseTimestamp(value: string): string {
  return value.replace(' ', 'T')
}

const parsers: Record<number, (value: string) => unknown> = {
  [OID.int8]: Number,
  [OID.numeric]: Number,
  [OID.date]: (value) => value,
  [OID.timestamp]: parseTimestamp,
  [OID.timestamptz]: parseTimestamptz,
}

/**
 * Per-pool type overrides. Passed as `types` to the Pool rather than set with
 * types.setTypeParser, so nothing global changes for other pg users.
 */
export const pgTypes = {
  getTypeParser(oid: number, format?: 'text' | 'binary') {
    return parsers[oid] ?? types.getTypeParser(oid, format)
  },
} as unknown as typeof types
