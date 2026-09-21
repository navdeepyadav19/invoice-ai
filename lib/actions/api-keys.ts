'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession, requireRealAccount } from '@/lib/auth/context'
import { generateApiKey } from '@/lib/auth/api-key'
import { isScope, type Scope } from '@/lib/auth/scopes'
import { toActionError } from '@/lib/actions/to-action-error'
import { withValues, type FormValues } from '@/lib/form-state'
import type { ApiKeyRow } from '@/lib/database.types'

/**
 * Creating and revoking API keys — web UI only, deliberately.
 *
 * There is no `keys:manage` scope and no /api/v1 route for any of this. A
 * leaked key therefore cannot mint more keys, widen its own scopes, or revoke
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

    // Guests are reaped by cleanup_stale_guests after 30 days. A key belonging
    // to a deleted owner is a credential pointing at nothing.
    requireRealAccount(ctx)

    const key = generateApiKey()

    const { error } = await ctx.supabase.from('api_keys').insert({
      owner_id: ctx.userId,
      name,
      prefix: key.prefix,
      secret_hash: key.secretHash,
      scopes,
      expires_at:
        expiresInDays > 0
          ? new Date(Date.now() + expiresInDays * 86_400_000).toISOString()
          : null,
    })

    if (error) return withValues({ error: error.message }, formData)

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

    const { error } = await ctx.supabase
      .from('api_keys')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
      .is('revoked_at', null)

    if (error) return { error: error.message }
  } catch (cause) {
    return toActionError(cause)
  }

  revalidatePath('/settings/api-keys')
  return {}
}

export async function listApiKeys(): Promise<ApiKeyRow[]> {
  const ctx = await contextFromSession()

  const { data } = await ctx.supabase
    .from('api_keys')
    .select('*')
    .order('created_at', { ascending: false })

  return (data ?? []) as ApiKeyRow[]
}

export async function keyScopes(row: ApiKeyRow): Promise<Scope[]> {
  return row.scopes.filter(isScope)
}
