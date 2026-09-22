'use server'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import { isScope, type Scope } from '@/lib/auth/scopes'
import { checkRateLimit } from '@/lib/api/rate-limit'
import { formatUserCode, normaliseUserCode } from '@/lib/cli-auth/device'
import { CLI_DEFAULT_SCOPES } from '@/lib/cli-auth/scopes'
import { lookupCliLogin, type CliLoginRequest } from '@/lib/cli-auth/lookup'
import { toActionError } from '@/lib/actions/to-action-error'
import { withValues, type FormValues } from '@/lib/form-state'

/**
 * The browser half of `invoice-ai login`: look up a user code, then Authorize
 * or Deny it. Nothing here creates a key — approval only records who approved
 * and which scopes. The key is minted when the CLI next polls /api/cli/token,
 * so its plaintext is never in this page, a cookie, or the database.
 */

export interface CliAuthorizeState {
  step: 'enter' | 'confirm' | 'approved' | 'denied'
  /** Display form, WXYZ-2345. Set from `confirm` onwards. */
  userCode?: string
  request?: CliLoginRequest
  error?: string
  fieldErrors?: Record<string, string>
  values?: FormValues
}

/**
 * Brute-forcing a user code from a signed-in account is already hopeless
 * (28^8 codes, each alive 10 minutes); this just keeps anyone from trying.
 */
const LOOKUP_RULE = { limit: 20, windowSeconds: 60 }

const GONE =
  'That code isn’t valid any more — it may have expired or already been used. Run `invoice-ai login` again for a new one.'

export async function cliAuthorizeAction(
  _previous: CliAuthorizeState,
  formData: FormData,
): Promise<CliAuthorizeState> {
  await requireUser()

  const intent = String(formData.get('intent') ?? 'lookup')
  const raw = String(formData.get('user_code') ?? '')
  const code = normaliseUserCode(raw)

  if (!code) {
    return withValues(
      {
        step: 'enter' as const,
        error: 'Enter the 8-character code shown in your terminal.',
        fieldErrors: { user_code: 'Looks like XXXX-XXXX' },
      },
      formData,
    )
  }

  try {
    const ctx = await contextFromSession()

    if (ctx.isAnonymous) {
      return { step: 'enter', error: 'Create an account before authorizing the CLI.' }
    }

    const limit = await checkRateLimit(ctx.userId, 'cli-authorize', LOOKUP_RULE)
    if (!limit.ok) {
      return withValues(
        { step: 'enter' as const, error: 'Too many attempts. Wait a minute and try again.' },
        formData,
      )
    }

    const request = await lookupCliLogin(ctx.supabase, code)
    if (!request) return withValues({ step: 'enter' as const, error: GONE }, formData)

    const confirm = { step: 'confirm' as const, userCode: formatUserCode(code), request }

    if (intent === 'lookup') return confirm

    if (intent !== 'approve' && intent !== 'deny') {
      return { ...confirm, error: 'Choose Authorize or Deny.' }
    }

    const approve = intent === 'approve'
    const scopes = formData
      .getAll('scopes')
      .map(String)
      .filter((value): value is Scope => isScope(value) && CLI_DEFAULT_SCOPES.includes(value))

    if (approve && !scopes.length) {
      return withValues(
        {
          ...confirm,
          error: 'Pick at least one permission.',
          fieldErrors: { scopes: 'A CLI with no permissions cannot do anything' },
        },
        formData,
      )
    }

    const { data, error } = await ctx.supabase.rpc('cli_device_decide', {
      p_user_code: code,
      p_approve: approve,
      p_scopes: approve ? scopes : [],
    })

    if (error) return withValues({ ...confirm, error: error.message }, formData)

    switch (data) {
      case 'approved':
        // No key exists yet — it is minted when the CLI next polls, and shows
        // up in Settings → API keys from then on.
        return { step: 'approved', userCode: confirm.userCode, request }
      case 'denied':
        return { step: 'denied', userCode: confirm.userCode, request }
      case 'guest':
        return { step: 'enter', error: 'Create an account before authorizing the CLI.' }
      default:
        return { step: 'enter', error: GONE }
    }
  } catch (cause) {
    return withValues({ step: 'enter' as const, ...toActionError(cause) }, formData)
  }
}
