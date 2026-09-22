/**
 * Cursor pagination over (created_at, id).
 *
 * Not offset pagination. `?page=2` re-runs the query and skips N rows, so an
 * invoice created while an integration is walking the list shifts every later
 * row down one — the client silently never sees the row that moved across the
 * page boundary. For a sync job that is a missing invoice, discovered months
 * later during a reconciliation.
 *
 * A cursor names a *position* instead: "everything older than this row". New
 * rows appear at the front, where a client walking backwards never was.
 *
 * `id` is in the key because `created_at` is not unique — two invoices created
 * in the same millisecond would otherwise make the boundary ambiguous and drop
 * or duplicate one of them.
 */

import { isUuid } from '@/lib/catalog/ids'
import { ServiceError } from '@/lib/services/errors'

export interface Page<T> {
  data: T[]
  /** Opaque. Pass it back as `cursor`; never parse it client-side. */
  next_cursor: string | null
}

export interface CursorPosition {
  createdAt: string
  id: string
}

/**
 * Base64url, not because it is secret — it obviously isn't — but because an
 * opaque string is a contract that says "do not build these yourself". A client
 * that hand-crafts `created_at < X` cursors is a client that breaks when we add
 * a tiebreaker column.
 */
export function encodeCursor(position: CursorPosition): string {
  return Buffer.from(`${position.createdAt}|${position.id}`, 'utf8').toString('base64url')
}

export function decodeCursor(cursor?: string | null): CursorPosition | null {
  if (!cursor) return null

  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8')
    const separator = raw.lastIndexOf('|')
    if (separator === -1) return null

    const createdAt = raw.slice(0, separator)
    const id = raw.slice(separator + 1)
    if (!createdAt || !id) return null

    // A malformed cursor is a client bug, and returning page one instead would
    // hide it — the integration would loop forever without noticing.
    return { createdAt, id }
  } catch {
    return null
  }
}

/**
 * The cursor a list endpoint was given, or a 422 if it can't be one of ours.
 *
 * `decodeCursor` alone answers a bad cursor with `null`, and a service that
 * treats `null` as "no cursor" serves page one again — a sync job walking the
 * list would loop forever without noticing. So a cursor that is present but
 * unreadable is a `validation` error on `cursor`. The parts are checked too:
 * they end up inside a PostgREST filter, so only a real timestamp and UUID
 * may reach it.
 */
export function parseCursor(cursor?: string | null): CursorPosition | null {
  if (!cursor) return null

  const position = decodeCursor(cursor)
  if (!position || !isUuid(position.id) || Number.isNaN(Date.parse(position.createdAt))) {
    throw new ServiceError('validation', 'The cursor is not valid.', [
      { path: 'cursor', message: 'Pass the `next_cursor` from the previous page, unchanged.' },
    ])
  }
  return position
}

/** The PostgREST filter for "strictly after this position" in (created_at, id) desc order. */
export function afterFilter(position: CursorPosition): string {
  return `created_at.lt.${position.createdAt},and(created_at.eq.${position.createdAt},id.lt.${position.id})`
}

/** 1–100, 25 by default. */
export function clampLimit(limit?: number): number {
  if (!limit || Number.isNaN(limit)) return 25
  return Math.min(Math.max(Math.trunc(limit), 1), 100)
}

/** Rows were fetched with `limit + 1`: the extra row says whether another page exists. */
export function toPage<T extends { created_at: string; id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data.at(-1)

  return {
    data,
    next_cursor: hasMore && last ? encodeCursor({ createdAt: last.created_at, id: last.id }) : null,
  }
}
