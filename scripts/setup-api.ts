/**
 * One-shot setup for the public API.
 *
 * Everything the API needs that cannot be committed: a pepper, a cron secret,
 * and an ES256 keypair whose public half Supabase must hold so it will verify
 * the short-lived tokens each API request runs under.
 *
 *   pnpm api:setup            generate secrets, print .env.local lines
 *   pnpm api:setup --import   also upload the public key to Supabase (standby)
 *   pnpm api:setup --verify   mint a token and check Postgres accepts it
 *
 * The --import step is the one that writes to your Supabase project. It creates
 * the key in `standby`, which means Supabase will VERIFY tokens signed by it but
 * will not itself SIGN user sessions with it. That distinction matters: a key
 * rotated to `in_use` signs every session in the project, which would make this
 * private key the single most sensitive secret in the system. Standby keeps the
 * blast radius to "can mint an API token", which is what we actually need.
 *
 * --verify is the empirical answer to the open question in the plan: does a
 * standby key actually verify? It mints a token for a real user id and asks
 * PostgREST for one row. A 200 means yes.
 */

import { appendFileSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

import { exportJWK, generateKeyPair, importJWK, SignJWT } from 'jose'

const ROOT = resolve(import.meta.dirname, '..')
const ENV_PATH = resolve(ROOT, '.env.local')
const KEY_PATH = resolve(ROOT, '.api-signing-key.json')

const args = new Set(process.argv.slice(2))

function accessToken(): string {
  // The CLI stores it in the macOS keychain rather than a file.
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', 'Supabase CLI', '-w'],
      { encoding: 'utf8' },
    ).trim()
  } catch {
    const fromEnv = process.env.SUPABASE_ACCESS_TOKEN
    if (fromEnv) return fromEnv
    throw new Error('No Supabase access token. Run `npx supabase login`, or set SUPABASE_ACCESS_TOKEN.')
  }
}

function projectRef(): string {
  const env = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const match = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env)
  if (!match) throw new Error('Could not read the project ref from NEXT_PUBLIC_SUPABASE_URL in .env.local')
  return match[1]
}

async function main() {
  // ---- 1. local material -------------------------------------------------
  let keyFile: { kid: string; privateJwk: Record<string, unknown>; publicJwk: Record<string, unknown> }

  if (existsSync(KEY_PATH)) {
    keyFile = JSON.parse(readFileSync(KEY_PATH, 'utf8'))
    console.log('Reusing the existing keypair in .api-signing-key.json')
  } else {
    const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
    const kid = randomUUID()

    keyFile = {
      kid,
      privateJwk: { ...(await exportJWK(privateKey)), kid, alg: 'ES256', use: 'sig', key_ops: ['sign', 'verify'], ext: true },
      publicJwk: { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' },
    }

    writeFileSync(KEY_PATH, `${JSON.stringify(keyFile, null, 2)}\n`, { mode: 0o600 })
    console.log('Generated a new ES256 keypair → .api-signing-key.json (gitignored, chmod 600)')
  }

  /**
   * Reuse whatever is already in .env.local.
   *
   * Regenerating API_KEY_PEPPER invalidates every API key that has ever been
   * issued — silently, because the hashes simply stop matching and every
   * request starts returning 401. Running this script twice must not do that.
   */
  const existingEnv = existsSync(ENV_PATH) ? readFileSync(ENV_PATH, 'utf8') : ''
  const existing = (name: string): string | undefined =>
    new RegExp(`^${name}=(.+)$`, 'm').exec(existingEnv)?.[1]?.trim() || undefined

  const secrets = {
    API_KEY_PEPPER: existing('API_KEY_PEPPER') ?? randomBytes(48).toString('base64'),
    CRON_SECRET: existing('CRON_SECRET') ?? randomBytes(32).toString('base64url'),
  }

  for (const name of ['API_KEY_PEPPER', 'CRON_SECRET'] as const) {
    if (existing(name)) console.log(`Reusing the existing ${name} from .env.local`)
  }

  // ---- 2. import to Supabase --------------------------------------------
  if (args.has('--import')) {
    const ref = projectRef()
    console.log(`\nImporting the public key into ${ref} as a STANDBY key…`)

    const response = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/config/auth/signing-keys`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          algorithm: 'ES256',
          status: 'standby',
          private_jwk: keyFile.privateJwk,
        }),
      },
    )

    const text = await response.text()
    if (!response.ok) {
      console.error(`  failed (${response.status}): ${text}`)
      process.exitCode = 1
      return
    }
    console.log(`  imported: ${text.slice(0, 200)}`)
  }

  // ---- 3. verify ---------------------------------------------------------
  if (args.has('--verify')) {
    const ref = projectRef()
    const env = readFileSync(ENV_PATH, 'utf8')
    const publishable = /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=(.+)/.exec(env)?.[1]?.trim()

    if (!publishable) {
      console.error('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY missing from .env.local')
      process.exitCode = 1
      return
    }

    const userId = process.env.VERIFY_USER_ID
    if (!userId) {
      console.error('Set VERIFY_USER_ID to a real auth.users id to verify.')
      process.exitCode = 1
      return
    }

    // Same conflict as lib/auth/mint.ts: Supabase's API demands
    // key_ops ["sign","verify"], WebCrypto refuses "verify" on a private EC key.
    const signingJwk = { ...keyFile.privateJwk }
    delete signingJwk.key_ops
    delete signingJwk.use
    const key = await importJWK(signingJwk as Parameters<typeof importJWK>[0], 'ES256')
    const token = await new SignJWT({ role: 'authenticated', aud: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: keyFile.kid, typ: 'JWT' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(key)

    // If a standby key verifies, PostgREST answers as that user and RLS applies.
    const probe = await fetch(`https://${ref}.supabase.co/rest/v1/businesses?select=id&limit=1`, {
      headers: { apikey: publishable, authorization: `Bearer ${token}` },
    })

    console.log(`\nVerification probe: HTTP ${probe.status}`)
    console.log(`  ${(await probe.text()).slice(0, 300)}`)
    console.log(
      probe.ok
        ? '  → Supabase accepts tokens signed by the standby key. Minting works.'
        : '  → Rejected. The key may need rotating to in_use, or the import did not land.',
    )
  }

  // ---- 4. tell the user what to paste -----------------------------------
  console.log('\nAdd these to .env.local (and to Vercel for a deployment):\n')
  console.log(`API_KEY_PEPPER=${secrets.API_KEY_PEPPER}`)
  console.log(`CRON_SECRET=${secrets.CRON_SECRET}`)
  console.log(`SUPABASE_JWT_KID=${keyFile.kid}`)
  console.log('SUPABASE_JWT_PRIVATE_KEY_JWK=<contents of .api-signing-key.json privateJwk>')

  if (args.has('--write-env')) {
    appendFileSync(
      ENV_PATH,
      [
        '',
        '# --- added by scripts/setup-api.ts ---',
        `API_KEY_PEPPER=${secrets.API_KEY_PEPPER}`,
        `CRON_SECRET=${secrets.CRON_SECRET}`,
        `SUPABASE_JWT_KID=${keyFile.kid}`,
        `SUPABASE_JWT_PRIVATE_KEY_JWK=${JSON.stringify(keyFile.privateJwk)}`,
        '',
      ].join('\n'),
      'utf8',
    )
    console.log('\nWritten to .env.local.')
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
