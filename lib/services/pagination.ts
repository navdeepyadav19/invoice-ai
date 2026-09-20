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
