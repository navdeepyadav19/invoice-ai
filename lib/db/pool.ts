import 'server-only'

import { attachDatabasePool } from '@vercel/functions'
import { Pool } from 'pg'

import { pgTypes } from './parsers'
import { normaliseSsl } from './url'

/**
 * One pg Pool per server instance, created on first use.
 *
 * Lazy on purpose: `next build` and CI import this module without a database,
 * and must not need DATABASE_URL to succeed.
 *
 * DATABASE_URL is Neon's pooled (-pooler) endpoint, i.e. PgBouncer in
 * transaction mode. That is safe here only because every user-scoped setting
 * is transaction-local (SET LOCAL / set_config(..., true)) — see scoped.ts.
 */

let pool: Pool | undefined

export function getPool(): Pool {
  if (pool) return pool

  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error('DATABASE_URL is not set. Run `vercel env pull .env.local`.')
  }

  pool = new Pool({
    connectionString: normaliseSsl(url),
    max: 10,
    idleTimeoutMillis: 5_000,
    // Neon scales to zero; the first connection after idle wakes the compute.
    connectionTimeoutMillis: 10_000,
    types: pgTypes,
  })

  // Fluid compute: release idle clients before the instance is suspended,
  // instead of leaking them until Neon times them out.
  attachDatabasePool(pool)
  return pool
}
