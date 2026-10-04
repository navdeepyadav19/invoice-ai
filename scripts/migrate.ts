/**
 * Apply db/migrations/*.sql to the database in DATABASE_URL_UNPOOLED.
 *
 *   pnpm db:migrate            apply anything new
 *   pnpm db:migrate --status   list applied / pending, change nothing
 *
 * Deliberately small. Each file runs in its own transaction, in filename order,
 * and is recorded in app.schema_migrations with a checksum. Two rules make it
 * safe to run from a laptop and from CI alike:
 *
 *  - An advisory lock serialises concurrent runs, so two deploys can't both
 *    apply 0015 at once.
 *  - An applied file whose contents changed is a hard error, not a re-run.
 *    Migrations are history; fix forward with a new file.
 *
 * Uses the UNPOOLED url: advisory locks are session-scoped, and PgBouncer in
 * transaction mode would hand the lock to whichever client came next.
 */

import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Client } from 'pg'

import { normaliseSsl } from '../lib/db/url'

const ROOT = resolve(import.meta.dirname, '..')
const DIR = resolve(ROOT, 'db/migrations')
const LOCK_KEY = 7_141_726 // arbitrary, stable: "this app's migrations"

if (existsSync(resolve(ROOT, '.env.local'))) process.loadEnvFile(resolve(ROOT, '.env.local'))

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED
  if (!url) throw new Error('DATABASE_URL_UNPOOLED is not set. Run `vercel env pull .env.local`.')
  const statusOnly = process.argv.includes('--status')

  const files = readdirSync(DIR)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()

  const client = new Client({ connectionString: normaliseSsl(url) })
  await client.connect()
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_KEY])

    await client.query(`
      create schema if not exists app;
      create table if not exists app.schema_migrations (
        version text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`)

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from app.schema_migrations',
    )
    const applied = new Map(rows.map((r) => [r.version, r.checksum]))

    let ran = 0
    for (const file of files) {
      const sql = readFileSync(resolve(DIR, file), 'utf8')
      const checksum = createHash('sha256').update(sql).digest('hex')
      const previous = applied.get(file)

      if (previous) {
        if (previous !== checksum) {
          throw new Error(`${file} was edited after it was applied. Add a new migration instead.`)
        }
        if (statusOnly) console.log(`  applied  ${file}`)
        continue
      }

      if (statusOnly) {
        console.log(`  pending  ${file}`)
        continue
      }

      process.stdout.write(`  applying ${file} … `)
      await client.query('begin')
      try {
        await client.query(sql)
        await client.query('insert into app.schema_migrations (version, checksum) values ($1, $2)', [
          file,
          checksum,
        ])
        await client.query('commit')
      } catch (error) {
        await client.query('rollback')
        console.log('failed')
        throw error
      }
      console.log('done')
      ran++
    }

    if (!statusOnly) console.log(ran ? `Applied ${ran} migration(s).` : 'Up to date.')
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {})
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
