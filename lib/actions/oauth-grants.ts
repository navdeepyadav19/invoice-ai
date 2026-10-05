'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import { toActionError } from '@/lib/actions/to-action-error'
import { oauthListGrants, oauthRevokeGrant, type OAuthGrantListItem } from '@/lib/db/rpc'

/**
 * Connected AI assistants — list and disconnect, web UI only.
 *
 * The same rule as API keys: no scope and no API route can revoke a grant, so
 * an assistant cannot disconnect itself to hide what it did, nor disconnect a
 * different assistant. Both functions run as the signed-in user (ctx.db is
 * userDb), and the oauth_* functions check app.uid() themselves, so a grant id
 * that belongs to someone else is simply not found.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Active grants first, newest first. Everything in a row is safe to send to the browser. */
export async function listConnectedApps(): Promise<OAuthGrantListItem[]> {
  const ctx = await contextFromSession()
  return oauthListGrants(ctx.db)
}

/**
 * Disconnect an app: the grant and every access and refresh token under it are
 * revoked together (see oauth_revoke_grant in 0016). The next tool call the
 * assistant makes gets a 401.
 *
 * Revoke, don't delete — like API keys, the grant row stays so the activity
 * log can still name the app behind past requests.
 */
export async function revokeConnectedAppAction(id: string): Promise<{ error?: string }> {
  await requireUser()

  // A server action is a public endpoint; anything can arrive here. Postgres
  // would reject a non-uuid on the ::uuid cast, but as an "unexpected error"
  // that pollutes the logs, so turn it away first.
  if (!UUID.test(id)) return { error: 'That app could not be found.' }

  try {
    const ctx = await contextFromSession()

    // false means "not yours, or already revoked". Either way the app is not
    // connected for this user, but saying so beats a silent success when two
    // tabs race or the page is stale.
    const revoked = await oauthRevokeGrant(ctx.db, id)
    if (!revoked) {
      revalidatePath('/settings/ai-assistants')
      return { error: 'That app is already disconnected.' }
    }
  } catch (cause) {
    return toActionError(cause)
  }

  revalidatePath('/settings/ai-assistants')
  return {}
}
