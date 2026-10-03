import 'server-only'

import type { Db } from '@/lib/db'
import { cliDeviceLookup } from '@/lib/db/rpc'

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
export async function lookupCliLogin(db: Db, userCode: string): Promise<CliLoginRequest | null> {
  const row = await cliDeviceLookup(db, userCode)
  if (!row) return null

  return { clientName: row.client_name, clientOs: row.client_os, expiresAt: row.expires_at }
}
