import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
} from 'kysely'

import type { DB } from './schema'

/**
 * A Kysely instance with no database behind it, for unit tests.
 *
 * It compiles real Postgres SQL — the same compiler the app uses — and records
 * every statement instead of sending it. That lets a test assert on *what was
 * asked of the database* (a filter is in the WHERE clause, the limit is n + 1)
 * without a server, which is the point of most service tests.
 *
 * Rows come back from `respond`:
 *   - omitted               every query returns no rows
 *   - an array of row sets  one set per query, in order; then no rows
 *   - a function            called with each query; return its rows
 *
 * Transaction control (begin/commit/rollback) is recorded in `statements` but
 * never passed to `respond` and never appears in `queries`.
 */

export interface RecordedQuery {
  sql: string
  parameters: readonly unknown[]
}

export type FakeResponder =
  | ReadonlyArray<ReadonlyArray<Record<string, unknown>>>
  | ((query: RecordedQuery) => ReadonlyArray<Record<string, unknown>> | undefined | Promise<ReadonlyArray<Record<string, unknown>> | undefined>)

export type FakeDb = Kysely<DB> & {
  /** Every data statement, in order. */
  readonly queries: RecordedQuery[]
  /** Every statement including begin/commit/rollback, as SQL text. */
  readonly statements: string[]
}

export function fakeDb(respond?: FakeResponder): FakeDb {
  const queries: RecordedQuery[] = []
  const statements: string[] = []
  const queue = Array.isArray(respond) ? [...respond] : null

  const rowsFor = async (query: RecordedQuery): Promise<ReadonlyArray<Record<string, unknown>>> => {
    if (queue) return queue.shift() ?? []
    if (typeof respond === 'function') return (await respond(query)) ?? []
    return []
  }

  const connection: DatabaseConnection = {
    async executeQuery<R>(compiled: CompiledQuery): Promise<QueryResult<R>> {
      const query: RecordedQuery = { sql: compiled.sql, parameters: [...compiled.parameters] }
      queries.push(query)
      statements.push(query.sql)
      const rows = (await rowsFor(query)) as R[]
      return { rows: [...rows], numAffectedRows: BigInt(rows.length) }
    },
    async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
      throw new Error('fakeDb does not support streaming queries.')
    },
  }

  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      return connection
    },
    async beginTransaction() {
      statements.push('begin')
    },
    async commitTransaction() {
      statements.push('commit')
    },
    async rollbackTransaction() {
      statements.push('rollback')
    },
    async releaseConnection() {},
    async destroy() {},
  }

  const db = new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })

  return Object.assign(db, { queries, statements })
}
