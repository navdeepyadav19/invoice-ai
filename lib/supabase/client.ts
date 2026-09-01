'use client'

import { createBrowserClient } from '@supabase/ssr'

import { supabasePublishableKey, supabaseUrl } from './env'
import type { Database } from '@/lib/database.types'

/**
 * Browser-side Supabase client. Safe to call repeatedly — createBrowserClient
 * memoises internally, so every component gets the same session and the same
 * auth listener rather than each one racing to refresh the token.
 */
export function createClient() {
  return createBrowserClient<Database>(supabaseUrl(), supabasePublishableKey())
}
