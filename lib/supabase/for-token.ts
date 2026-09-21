import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'

import { supabasePublishableKey, supabaseUrl } from '@/lib/supabase/env'
import type { Database } from '@/lib/database.types'

/**
 * A Supabase client authenticated by a bearer token instead of a cookie.
 *
 * This is the single reason an API key can be safe. The tempting shortcut is to
 * look up the key, then query with the service_role key — but service_role
 * *bypasses RLS entirely*, so one forgotten `.eq('owner_id', …)` anywhere leaks
 * another business's invoices. The security boundary would move out of the
 * database and into every line of application code.
 *
 * Instead the API key is exchanged for a short-lived JWT that says
 * `sub = <owner>, role = authenticated` (see lib/auth/mint.ts), and Postgres
 * applies exactly the same `owner_id = auth.uid()` policies it applies to a
 * browser session. There is nothing new to get right.
 *
 * `accessToken` is Supabase's documented hook for externally-minted tokens and
 * is preferred over setting the Authorization header by hand: the client calls
 * it per request, so a token that expires mid-session can be re-minted, and it
 * keeps supabase-js from trying to manage a session it doesn't own.
 */
export function createTokenClient(accessToken: string | (() => Promise<string>)): SupabaseClient<Database> {
  return createSupabaseClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    accessToken: async () => (typeof accessToken === 'string' ? accessToken : accessToken()),
    auth: {
      // There are no cookies and no browser here. Persisting or refreshing a
      // session would be meaningless at best and cross-request state at worst.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}
