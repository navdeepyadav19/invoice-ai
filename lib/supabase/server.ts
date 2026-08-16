import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'

import { supabasePublishableKey, supabaseUrl } from './env'
import type { Database } from '@/lib/database.types'

/**
 * Server-side Supabase client for Server Components, Server Actions and Route
 * Handlers.
 *
 * `cookies()` is async in this version of Next, hence the await. The try/catch
 * around setAll is load-bearing rather than defensive noise: Server Components
 * are not allowed to write cookies, so a token refresh triggered from one would
 * throw. Swallowing it is correct because proxy.ts has already refreshed the
 * session for this request — see lib/supabase/proxy.ts.
 */
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient<Database>(supabaseUrl(), supabasePublishableKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component. Safe to ignore.
        }
      },
    },
  })
}

/**
 * The authenticated user, verified against the auth server.
 *
 * Always prefer this to getSession() for anything that gates access. getSession
 * only decodes the cookie, which the client controls; getUser makes a round trip
 * that validates the JWT signature and expiry.
 */
export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}
