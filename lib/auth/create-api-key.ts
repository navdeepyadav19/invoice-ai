import 'server-only'

import { generateApiKey } from '@/lib/auth/api-key'
import type { Scope } from '@/lib/auth/scopes'
import type { Db } from '@/lib/db'

/**
 * The one way an API key row comes into existence.
 *
 * Shared by the Settings → API keys form (createApiKeyAction) and the CLI device
 * flow (/api/cli/token). Both pass a database handle scoped AS the owner
 * (userDb) — from the cookie session in the first case, from the approved
 * device code's owner in the second — so the insert goes through the same
 * `own api keys` RLS policy either way. There is no owner-connection path that
 * could write a key for someone else.
 */

export interface CreateApiKeyInput {
  ownerId: string
  name: string
  scopes: readonly Scope[]
  /** ISO timestamp, or null for a key that never expires. */
  expiresAt: string | null
}

export type CreateApiKeyResult =
  | {
      ok: true
      id: string
      prefix: string
      /** The ONLY time the full key exists. Never stored, never recoverable. */
      plaintext: string
    }
  | { ok: false; error: string }

export async function createApiKeyForOwner(db: Db, input: CreateApiKeyInput): Promise<CreateApiKeyResult> {
  const key = generateApiKey()

  try {
    const row = await db
      .insertInto('api_keys')
      .values({
        owner_id: input.ownerId,
        name: input.name,
        prefix: key.prefix,
        secret_hash: key.secretHash,
        scopes: [...input.scopes],
        expires_at: input.expiresAt,
      })
      .returning('id')
      .executeTakeFirstOrThrow()

    return { ok: true, id: row.id, prefix: key.prefix, plaintext: key.plaintext }
  } catch (error) {
    // The raw database message names tables and constraints; log it, don't show it.
    console.error('[api-keys] insert failed', error instanceof Error ? error.message : error)
    return { ok: false, error: 'Could not create the API key. Try again.' }
  }
}
