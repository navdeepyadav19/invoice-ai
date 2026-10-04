import 'server-only'

import type { Kysely, Transaction } from 'kysely'

import { getPool } from './pool'
import { scopedDb } from './scoped'
import type { DB } from './schema'

/**
 * The only two ways application code reaches the database.
 *
 *   userDb(id)  every statement runs as `authenticated` with app.uid() = id,
 *               so RLS does tenant isolation exactly as it did on Supabase.
 *   anonDb()    runs as `anon`: no table access at all, only the public
 *               token-taking functions (public invoice, API-key lookup, CLI
 *               device start/poll, email-link redemption).
 *
 * There is deliberately no third, all-seeing client here. The one job that
 * needs it — the webhook cron — imports lib/db/system.ts, and an ESLint rule
 * keeps everything else from doing the same.
 */

export type Db = Kysely<DB> | Transaction<DB>
export type { DB }

const connect = () => getPool().connect()

export function userDb(userId: string): Kysely<DB> {
  return scopedDb({ role: 'authenticated', userId }, connect)
}

let anon: Kysely<DB> | undefined

export function anonDb(): Kysely<DB> {
  return (anon ??= scopedDb({ role: 'anon' }, connect))
}
