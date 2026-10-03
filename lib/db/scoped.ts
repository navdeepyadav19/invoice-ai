import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  type QueryResult,
  type TransactionSettings,
} from 'kysely'

import type { DB } from './schema'

/**
 * A Kysely instance that can only ever run as one tenant.
 *
 * This replaces what PostgREST did for us on Supabase: turn "who is asking"
 * into a Postgres role plus a user id that RLS policies read. Every statement
 * this driver runs is wrapped as
 *
 *   BEGIN; SET LOCAL ROLE authenticated; SELECT set_config('app.user_id', …, true)
 *   <the query>
 *   COMMIT
 *
 * and inside an explicit `db.transaction()` the same prelude runs once, right
 * after BEGIN. Three properties follow, and each is load-bearing:
 *
 *  1. It cannot be forgotten. The login role has BYPASSRLS on Neon, so a single
 *     un-switched query would read every tenant. Putting the switch in the
 *     driver, not in a helper callers must remember, makes that impossible.
 *  2. It is safe behind PgBouncer. SET LOCAL and set_config(…, true) die with
 *     the transaction, so the next client to borrow this connection inherits
 *     nothing — unlike a session-level SET, which would leak identity.
 *  3. One statement = one transaction, exactly the semantics PostgREST had, so
 *     services ported from supabase-js behave the same. Multi-step work that
 *     must be atomic opts in with `db.transaction().execute(...)`.
 */

export type DbScope =
  | { role: 'anon' }
  | { role: 'authenticated'; userId: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The SQL that pins a scope. One string, sent with the simple protocol (no
 * parameters), so it can carry several statements in a single round trip.
 *
 * The role comes from a closed union and the user id is checked to be a uuid
 * before it is quoted, so nothing caller-controlled is ever spliced in raw.
 */
export function scopePrelude(scope: DbScope): string {
  if (scope.role === 'anon') return 'set local role anon'
  if (!UUID.test(scope.userId)) throw new Error('scopedDb: userId must be a uuid.')
  return `set local role authenticated; select set_config('app.user_id', '${scope.userId}', true)`
}

/** The slice of pg's PoolClient this driver uses. Narrow so tests can fake it. */
export interface ScopedClient {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null; command: string }>
  release(error?: Error | boolean): void
}

export type ConnectFn = () => Promise<ScopedClient>

class ScopedConnection implements DatabaseConnection {
  inTransaction = false
  broken = false

  constructor(
    readonly client: ScopedClient,
    readonly prelude: string,
  ) {}

  private async run<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    const result = await this.client.query(query.sql, [...query.parameters])
    const mutated = ['INSERT', 'UPDATE', 'DELETE', 'MERGE'].includes(result.command)
    return {
      rows: result.rows as R[],
      numAffectedRows: mutated ? BigInt(result.rowCount ?? 0) : undefined,
    }
  }

  async executeQuery<R>(query: CompiledQuery): Promise<QueryResult<R>> {
    if (this.inTransaction) return this.run<R>(query)

    await this.client.query(`begin; ${this.prelude}`)
    try {
      const result = await this.run<R>(query)
      await this.client.query('commit')
      return result
    } catch (error) {
      // If even ROLLBACK fails the connection is in an unknown state; flag it
      // so release() destroys it instead of returning it to the pool.
      await this.client.query('rollback').catch(() => {
        this.broken = true
      })
      throw error
    }
  }

  async *streamQuery<R>(): AsyncIterableIterator<QueryResult<R>> {
    throw new Error('scopedDb does not support streaming queries.')
  }
}

class ScopedDriver implements Driver {
  constructor(
    private readonly connect: ConnectFn,
    private readonly prelude: string,
  ) {}

  async init(): Promise<void> {}

  async acquireConnection(): Promise<DatabaseConnection> {
    return new ScopedConnection(await this.connect(), this.prelude)
  }

  async beginTransaction(connection: DatabaseConnection, settings: TransactionSettings): Promise<void> {
    const c = connection as ScopedConnection
    const mode = [
      settings.isolationLevel && `isolation level ${settings.isolationLevel}`,
      settings.accessMode,
    ]
      .filter(Boolean)
      .join(' ')
    await c.client.query(`begin${mode ? ` ${mode}` : ''}; ${c.prelude}`)
    c.inTransaction = true
  }

  async commitTransaction(connection: DatabaseConnection): Promise<void> {
    const c = connection as ScopedConnection
    c.inTransaction = false
    await c.client.query('commit')
  }

  async rollbackTransaction(connection: DatabaseConnection): Promise<void> {
    const c = connection as ScopedConnection
    c.inTransaction = false
    await c.client.query('rollback')
  }

  async releaseConnection(connection: DatabaseConnection): Promise<void> {
    const c = connection as ScopedConnection
    c.client.release(c.broken ? new Error('Connection left in an unknown state.') : undefined)
  }

  // The pool is shared by the whole process; a per-request instance never ends it.
  async destroy(): Promise<void> {}
}

export function scopedDb(scope: DbScope, connect: ConnectFn): Kysely<DB> {
  const prelude = scopePrelude(scope)
  return new Kysely<DB>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new ScopedDriver(connect, prelude),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  })
}
