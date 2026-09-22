import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/database.types'

/** What the consent screen shows about a pending CLI login. */
export interface CliLoginRequest {
  clientName: string
  clientOs: string | null
  expiresAt: string
}

/**
 * A pending, unexpired login for this (normalised) user code, or null.
 *
 * Runs as the signed-in user; cli_device_lookup refuses anon callers and never
 * reveals anything about finished codes.
 */
export async function lookupCliLogin(
  supabase: SupabaseClient<Database>,
  userCode: string,
): Promise<CliLoginRequest | null> {
  const { data, error } = await supabase.rpc('cli_device_lookup', { p_user_code: userCode })
  if (error) throw new Error(`cli_device_lookup failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null

  return { clientName: row.client_name, clientOs: row.client_os, expiresAt: row.expires_at }
}
