import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import { generateApiKey } from '@/lib/auth/api-key'
import type { Scope } from '@/lib/auth/scopes'
import type { Database } from '@/lib/database.types'

/**
 * The one way an API key row comes into existence.
 *
 * Shared by the Settings → API keys form (createApiKeyAction) and the CLI device
 * flow (/api/cli/token). Both pass a Supabase client that is authenticated AS
 * the owner — a cookie session in the first case, a minted user token in the
 * second — so the insert goes through the same `own api keys` RLS policy either
 * way. There is no service-role path that could write a key for someone else.
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

export async function createApiKeyForOwner(
  supabase: SupabaseClient<Database>,
  input: CreateApiKeyInput,
): Promise<CreateApiKeyResult> {
  const key = generateApiKey()

  const { data, error } = await supabase
    .from('api_keys')
    .insert({
      owner_id: input.ownerId,
      name: input.name,
      prefix: key.prefix,
      secret_hash: key.secretHash,
      scopes: [...input.scopes],
      expires_at: input.expiresAt,
    })
    .select('id')
    .single()

  if (error) return { ok: false, error: error.message }

  return { ok: true, id: data.id, prefix: key.prefix, plaintext: key.plaintext }
}
