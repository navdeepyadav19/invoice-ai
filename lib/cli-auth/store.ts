import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'

import { createApiKeyForOwner } from '@/lib/auth/create-api-key'
import { mintUserToken } from '@/lib/auth/mint'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { apiSetupStatus } from '@/lib/api/setup-status'
import type { DeviceStore, HandlerDeps, OwnerSession, PollResult } from '@/lib/cli-auth/handlers'
import { createTokenClient } from '@/lib/supabase/for-token'
import { siteUrl, supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env'
import type { Database } from '@/lib/database.types'

/**
 * The real DeviceStore: the cli_device_* functions from migration 0013.
 *
 * There is no service-role client anywhere in this app, and this does not add
 * one. The unauthenticated steps (start, poll) call SECURITY DEFINER functions
 * as anon — possession of the device code is the credential, exactly like
 * api_key_by_prefix. Everything after approval runs AS the approving user via a
 * minted 60-second token, so the key insert is checked by the same `own api
 * keys` RLS policy as the Settings page.
 */

function anonClient() {
  return createSupabaseClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
}

export const deviceStore: DeviceStore = {
  async start(input) {
    const { data, error } = await anonClient().rpc('cli_device_start', {
      p_device_code_hash: input.deviceCodeHash,
      p_user_code: input.userCode,
      p_client_name: input.clientName,
      p_client_os: input.clientOs,
    })
    if (error) throw new Error(`cli_device_start failed: ${error.message}`)
    return data
  },

  async poll(deviceCodeHash): Promise<PollResult> {
    const { data, error } = await anonClient().rpc('cli_device_poll', {
      p_device_code_hash: deviceCodeHash,
    })
    if (error) throw new Error(`cli_device_poll failed: ${error.message}`)

    const row = Array.isArray(data) ? data[0] : data
    if (!row) return { outcome: 'invalid_grant', ownerId: null, scopes: null, clientName: null }

    return {
      outcome: row.outcome,
      ownerId: row.owner_id,
      scopes: row.scopes,
      clientName: row.client_name,
    }
  },

  async asOwner(ownerId): Promise<OwnerSession> {
    // Re-minted per call: tokens live 60 seconds and this whole exchange takes
    // a handful of round trips.
    const supabase = createTokenClient(() => mintUserToken({ userId: ownerId }))

    return {
      async createKey({ name, scopes }) {
        return createApiKeyForOwner(supabase, { ownerId, name, scopes, expiresAt: null })
      },

      async attachKey(deviceCodeHash, keyId) {
        const { error } = await supabase.rpc('cli_device_attach_key', {
          p_device_code_hash: deviceCodeHash,
          p_api_key_id: keyId,
        })
        if (error) throw new Error(error.message)
      },

      async release(deviceCodeHash) {
        const { error } = await supabase.rpc('cli_device_release', {
          p_device_code_hash: deviceCodeHash,
        })
        if (error) throw new Error(error.message)
      },

      async account() {
        const [profile, business] = await Promise.all([
          supabase.from('profiles').select('email').eq('id', ownerId).maybeSingle(),
          supabase
            .from('businesses')
            .select('legal_name, trade_name')
            .eq('owner_id', ownerId)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle(),
        ])

        return {
          email: profile.data?.email ?? null,
          business_name: business.data?.trade_name || business.data?.legal_name || null,
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
