import 'server-only'

import { createApiKeyForOwner } from '@/lib/auth/create-api-key'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { apiSetupStatus } from '@/lib/api/setup-status'
import type { DeviceStore, HandlerDeps, OwnerSession, PollResult } from '@/lib/cli-auth/handlers'
import type { PollOutcome } from '@/lib/cli-auth/device'
import { anonDb, userDb } from '@/lib/db'
import { cliDeviceAttachKey, cliDevicePoll, cliDeviceRelease, cliDeviceStart } from '@/lib/db/rpc'
import { siteUrl } from '@/lib/env'

/**
 * The real DeviceStore: the cli_device_* functions from migration 0013.
 *
 * There is no owner connection anywhere in this flow, and this does not add
 * one. The unauthenticated steps (start, poll) call SECURITY DEFINER functions
 * as anon — possession of the device code is the credential, exactly like
 * api_key_by_prefix. Everything after approval runs AS the approving user
 * (userDb), so the key insert is checked by the same `own api keys` RLS policy
 * as the Settings page.
 */

export const deviceStore: DeviceStore = {
  async start(input) {
    const outcome = await cliDeviceStart(anonDb(), {
      deviceCodeHash: input.deviceCodeHash,
      userCode: input.userCode,
      clientName: input.clientName,
      // The column is nullable; the SQL function stores a null as-is.
      clientOs: input.clientOs as string,
    })
    return outcome as Awaited<ReturnType<DeviceStore['start']>>
  },

  async poll(deviceCodeHash): Promise<PollResult> {
    const row = await cliDevicePoll(anonDb(), deviceCodeHash)
    if (!row) return { outcome: 'invalid_grant', ownerId: null, scopes: null, clientName: null }

    return {
      outcome: row.outcome as PollOutcome,
      ownerId: row.owner_id,
      scopes: row.scopes,
      clientName: row.client_name,
    }
  },

  async asOwner(ownerId): Promise<OwnerSession> {
    const db = userDb(ownerId)

    return {
      async createKey({ name, scopes }) {
        return createApiKeyForOwner(db, { ownerId, name, scopes, expiresAt: null })
      },

      async attachKey(deviceCodeHash, keyId) {
        await cliDeviceAttachKey(db, deviceCodeHash, keyId)
      },

      async release(deviceCodeHash) {
        await cliDeviceRelease(db, deviceCodeHash)
      },

      async account() {
        const [profile, business] = await Promise.all([
          db.selectFrom('profiles').select('email').where('id', '=', ownerId).executeTakeFirst(),
          db
            .selectFrom('businesses')
            .select(['legal_name', 'trade_name'])
            .where('owner_id', '=', ownerId)
            .orderBy('created_at', 'asc')
            .limit(1)
            .executeTakeFirst(),
        ])

        return {
          email: profile?.email ?? null,
          business_name: business?.trade_name || business?.legal_name || null,
        }
      },
    }
  },
}

/** Production wiring for the route handlers. */
export function cliHandlerDeps(): HandlerDeps {
  return {
    store: deviceStore,
    rateLimit: (key, bucket, rule) => checkRateLimit(key, bucket, rule),
    siteUrl: siteUrl(),
    ready: () => apiSetupStatus().ready,
    log: (message, ...args) => console.error(message, ...args),
  }
}
