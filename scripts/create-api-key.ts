/**
 * Mint an API key from the command line, for testing.
 *
 * The web UI at /settings/api-keys is the real path — this exists so the API can
 * be exercised before anyone logs in, and so a smoke test can run unattended.
 *
 *   pnpm api:key <user-email> [scopes...]
 *
 * It deliberately calls the SAME generateApiKey() the UI does rather than
 * reimplementing the format. A test key hashed differently from a real one
 * would pass here and fail in production, which is the worst kind of green.
 */

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')

// Loaded before importing the key module, which reads API_KEY_PEPPER on use.
for (const line of readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n')) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
  if (match && !process.env[match[1]]) process.env[match[1]] = match[2]
}

import { generateApiKey } from '../lib/auth/api-key'
import { SCOPES } from '../lib/auth/scopes'

function accessToken(): string {
  return execFileSync('security', ['find-generic-password', '-s', 'Supabase CLI', '-w'], {
    encoding: 'utf8',
  }).trim()
}

function projectRef(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
  const match = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)
  if (!match) throw new Error('NEXT_PUBLIC_SUPABASE_URL is missing or malformed.')
  return match[1]
}

async function sql(query: string): Promise<unknown> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef()}/database/query`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
    },
  )

  const text = await response.text()
  if (!response.ok) throw new Error(`SQL failed (${response.status}): ${text}`)
  return JSON.parse(text)
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function main() {
  const [email, ...requested] = process.argv.slice(2)

  if (!email) {
    console.error('Usage: pnpm api:key <user-email> [scope ...]')
    process.exit(1)
  }

  const scopes = requested.length ? requested : [...SCOPES]

  const users = (await sql(
    `select id from auth.users where email = ${quote(email)} limit 1;`,
  )) as { id: string }[]

  if (!users.length) {
    console.error(`No user with email ${email}.`)
    process.exit(1)
  }

  const key = generateApiKey()
  const scopeLiteral = `array[${scopes.map(quote).join(',')}]::text[]`

  await sql(
    `insert into public.api_keys (owner_id, name, prefix, secret_hash, scopes)
     values (${quote(users[0].id)}, ${quote('CLI test key')}, ${quote(key.prefix)}, ${quote(key.secretHash)}, ${scopeLiteral});`,
  )

  console.log('\nAPI key created. This is the only time it is shown:\n')
  console.log(`  ${key.plaintext}\n`)
  console.log(`  owner:  ${email}`)
  console.log(`  scopes: ${scopes.join(', ')}\n`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
