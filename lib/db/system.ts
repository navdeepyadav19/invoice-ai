import 'server-only'

import { Kysely, PostgresDialect } from 'kysely'

import { getPool } from './pool'
import type { DB } from './schema'

/**
 * The owner connection: no role switch, so RLS does not apply.
 *
 * This is the successor to Supabase's service-role key and carries the same
 * warning. It exists for exactly one caller — the webhook delivery cron, which
 * must read deliveries across every tenant — and eslint.config.mjs refuses to
 * let anything else import it. If you are reaching for this to make a query
 * "just work", the query belongs in userDb() instead.
 */

let system: Kysely<DB> | undefined

export function systemDb(): Kysely<DB> {
  return (system ??= new Kysely<DB>({
    dialect: new PostgresDialect({ pool: async () => getPool() }),
  }))
}
