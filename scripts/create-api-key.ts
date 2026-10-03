/**
 * Create an API key from the command line, for testing.
 *
 * The web UI at /settings/api-keys is the real path — this exists so the API can
 * be exercised before anyone logs in, and so a smoke test can run unattended.
 *
 *   pnpm api:key <user-email> [scopes...]
 *
 * It deliberately calls the SAME generateApiKey() the UI does rather than
 * reimplementing the format. A test key hashed differently from a real one
 * would pass here and fail in production, which is the worst kind of green.
 *
 * Connects as the database owner (DATABASE_URL_UNPOOLED): it has to read
 * neon_auth."user" to resolve the email, which no app role can see.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { Client } from 'pg'

import { generateApiKey } from '../lib/auth/api-key'
import { SCOPES } from '../lib/auth/scopes'

const ROOT = resolve(import.meta.dirname, '..')
const ENV_FILE = resolve(ROOT, '.env.local')

// generateApiKey() reads API_KEY_PEPPER when called, not at import, so loading
// the file here (after the hoisted imports) is early enough.
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE)

async function main() {
  const [email, ...requested] = process.argv.slice(2)

  if (!email) {
    console.error('Usage: pnpm api:key <user-email> [scope ...]')
    process.exit(1)
  }

  const connectionString = process.env.DATABASE_URL_UNPOOLED
  if (!connectionString) {
    console.error('DATABASE_URL_UNPOOLED is not set. Run `vercel env pull .env.local`.')
    process.exit(1)
  }

  const scopes = requested.length ? requested : [...SCOPES]

  const client = new Client({ connectionString })
  await client.connect()

  try {
    const users = await client.query<{ id: string }>(
      'select id from neon_auth."user" where lower(email) = lower($1) limit 1',
      [email],
    )

    if (!users.rows.length) {
      console.error(`No user with email ${email}.`)
      process.exitCode = 1
      return
    }

    const key = generateApiKey()

    await client.query(
      `insert into public.api_keys (owner_id, name, prefix, secret_hash, scopes)
       values ($1, $2, $3, $4, $5::text[])`,
      [users.rows[0].id, 'CLI test key', key.prefix, key.secretHash, scopes],
    )

    console.log('\nAPI key created. This is the only time it is shown:\n')
    console.log(`  ${key.plaintext}\n`)
    console.log(`  owner:  ${email}`)
    console.log(`  scopes: ${scopes.join(', ')}\n`)
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
