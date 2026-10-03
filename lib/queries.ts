import { cache } from 'react'
import { redirect } from 'next/navigation'
import { connection } from 'next/server'

import { getAuth } from '@/lib/auth/server'
import { userDb, type Db } from '@/lib/db'
import type { BusinessRow, ProfileRow } from '@/lib/database.types'

/**
 * These are wrapped in React's `cache` so a layout and the page inside it can
 * each ask for the current user without triggering two round trips. The cache
 * is per-request, so it never leaks one user's data into another's render.
 */

/** The signed-in person, in the app's own shape rather than an auth vendor's. */
export interface AppUser {
  id: string
  email: string
  name: string | null
  /** Neon Auth's flag. True after Google sign-in; the app's own verification lives on the profile. */
  emailVerified: boolean
}

export const getCurrentUser = cache(async (): Promise<AppUser | null> => {
  // Who is signed in is a per-request fact. Say so before touching the auth
  // SDK, or `next build` tries to prerender every page that asks.
  await connection()
  const { data } = await getAuth().getSession()
  const user = data?.user
  if (!user) return null
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    emailVerified: Boolean(user.emailVerified),
  }
})

/** A database handle scoped to the signed-in user. RLS does the isolation. */
export const sessionDb = cache(async (): Promise<Db> => userDb((await requireUser()).id))

/**
 * Create the profile row if it isn't there yet.
 *
 * On Supabase a trigger on auth.users did this. Users now live in Neon Auth's
 * schema, which we don't own, so the app does it at the three moments a user
 * can first appear — sign-up, the OAuth landing, and (as a backstop) the first
 * profile read. `on conflict do nothing` makes every call after the first free.
 */
export async function ensureProfile(user: AppUser): Promise<void> {
  await userDb(user.id)
    .insertInto('profiles')
    .values({ id: user.id, email: user.email, full_name: user.name })
    .onConflict((oc) => oc.column('id').doNothing())
    .execute()
}

export const getProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const db = userDb(user.id)
  const read = () => db.selectFrom('profiles').selectAll().where('id', '=', user.id).executeTakeFirst()

  let profile = await read()
  if (!profile) {
    await ensureProfile(user)
    profile = await read()
  }
  return (profile as ProfileRow | undefined) ?? null
})

/**
 * A user has exactly one business in v1. Selecting the oldest row keeps the
 * behaviour deterministic if a future feature ever creates a second one.
 */
export const getPrimaryBusiness = cache(async (): Promise<BusinessRow | null> => {
  const user = await getCurrentUser()
  if (!user) return null

  const business = await userDb(user.id)
    .selectFrom('businesses')
    .selectAll()
    .orderBy('created_at', 'asc')
    .limit(1)
    .executeTakeFirst()

  return (business as BusinessRow | undefined) ?? null
})

export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  return user
}

export function needsOnboarding(profile: ProfileRow | null): boolean {
  return !profile?.onboarding_completed_at
}
