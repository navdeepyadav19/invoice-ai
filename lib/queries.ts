import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import type { BusinessRow, ProfileRow } from '@/lib/database.types'

/**
 * These are wrapped in React's `cache` so a layout and the page inside it can
 * each ask for the current user without triggering two round trips. The cache
 * is per-request, so it never leaks one user's data into another's render.
 */

export const getCurrentUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

export const getProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  return data ?? null
})

/**
 * A user has exactly one business in v1. Selecting the oldest row keeps the
 * behaviour deterministic if a future feature ever creates a second one.
 */
export const getPrimaryBusiness = cache(async (): Promise<BusinessRow | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('businesses')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  return data ?? null
})

export async function requireUser(): Promise<User> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

/**
 * Guests are exempt from onboarding on purpose: they enter their business
 * details inline in the builder, and being bounced into a wizard before they've
 * seen the product is exactly the friction guest mode exists to avoid. When a
 * guest upgrades to a real account, the upgrade action stamps
 * `onboarding_completed_at` for them so they are never asked to retype details
 * they already gave the builder.
 */
export function needsOnboarding(user: User, profile: ProfileRow | null): boolean {
  if (user.is_anonymous) return false
  return !profile?.onboarding_completed_at
}
