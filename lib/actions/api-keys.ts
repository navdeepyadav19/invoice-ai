'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import { createApiKeyForOwner } from '@/lib/auth/create-api-key'
import { isScope, type Scope } from '@/lib/auth/scopes'
import { toActionError } from '@/lib/actions/to-action-error'
import { withValues, type FormValues } from '@/lib/form-state'
import type { ApiKeyRow } from '@/lib/database.types'
import { q } from '@/lib/services/errors'

/**
 * Creating and revoking API keys — web UI only, deliberately.
 *
 * There is no `keys:manage` scope and no /api/v1 route for any of this. A
 * leaked key therefore cannot create more keys, widen its own scopes, or revoke
 * the audit trail of itself. The blast radius of a stolen credential stays
 * exactly what that credential was granted, and never grows.
 */

export interface CreateKeyState {
  error?: string
  fieldErrors?: Record<string, string>
  /** The ONLY time the full key exists. Never stored, never recoverable. */
  plaintext?: string
  prefix?: string
  /** The submitted name/scopes/expiry, echoed back on failure. */
  values?: FormValues
}

export async function createApiKeyAction(formData: FormData): Promise<CreateKeyState> {
  await requireUser()

  const name = String(formData.get('name') ?? '').trim()
  const scopes = formData.getAll('scopes').map(String).filter(isScope)
  const expiresInDays = Number(formData.get('expires_in_days') ?? 0)

  if (!name) {
    return withValues({ error: 'Give the key a name.', fieldErrors: { name: 'Required' } }, formData)
  }

  if (name.length > 100) {
    return withValues({ error: 'Keep the name under 100 characters.', fieldErrors: { name: 'Too long' } }, formData)
  }

  // Ten years is "never" for any practical purpose; anything beyond it (or not
  // a number at all) would only make new Date() throw.
  if (!Number.isFinite(expiresInDays) || expiresInDays < 0 || expiresInDays > 3650) {
    return withValues({ error: 'Pick a valid expiry.', fieldErrors: { expires_in_days: 'Invalid' } }, formData)
  }

  if (!scopes.length) {
    return withValues(
      {
        error: 'Pick at least one scope.',
        fieldErrors: { scopes: 'A key with no scopes cannot do anything' },
      },
      formData,
    )
  }

  try {
    const ctx = await contextFromSession()

    const key = await createApiKeyForOwner(ctx.db, {
      ownerId: ctx.userId,
      name,
      scopes,
      expiresAt:
        expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
          : null,
    })

    if (!key.ok) return withValues({ error: key.error }, formData)

    revalidatePath('/settings/api-keys')

    // Returned once, to be shown once. Nothing persists it.
    return { plaintext: key.plaintext, prefix: key.prefix }
  } catch (cause) {
    return withValues(toActionError(cause), formData)
  }
}

/**
 * Revoke, don't delete.
 *
 * The row survives so the audit log can still name the key behind past
 * requests. `api_requests.api_key_id` would otherwise go null and "which app
 * issued this invoice?" would lose its answer retroactively.
 */
export async function revokeApiKeyAction(id: string): Promise<{ error?: string }> {
  await requireUser()

  try {
    const ctx = await contextFromSession()

    await q(
      ctx.db
        .updateTable('api_keys')
        .set({ revoked_at: new Date().toISOString() })
        .where('id', '=', id)
        .where('revoked_at', 'is', null)
        .execute(),
    )
  } catch (cause) {
    return toActionError(cause)
  }

  revalidatePath('/settings/api-keys')
  return {}
}

/**
 * Everything but the secret hash. This feeds a client component, so whatever
 * is selected here is serialised into the page; the hash has no reason to
 * leave the server.
 */
export type ApiKeyListRow = Omit<ApiKeyRow, 'secret_hash'>

export async function listApiKeys(): Promise<ApiKeyListRow[]> {
  const ctx = await contextFromSession()

  const rows = await ctx.db
    .selectFrom('api_keys')
    .select(['id', 'owner_id', 'name', 'prefix', 'scopes', 'created_at', 'last_used_at', 'expires_at', 'revoked_at'])
    .orderBy('created_at', 'desc')
    .execute()

  return rows as ApiKeyListRow[]
}

export async function keyScopes(row: Pick<ApiKeyRow, 'scopes'>): Promise<Scope[]> {
  return row.scopes.filter(isScope)
}
