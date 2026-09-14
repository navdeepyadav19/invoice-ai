import 'server-only'

/**
 * Client for the Sandbox (sandbox.co.in) GST APIs.
 *
 * Three things about this API are easy to get wrong, and all three are handled
 * here rather than at the call sites:
 *
 *  1. The access token is NOT a Bearer token. Sending `Authorization: Bearer x`
 *     fails; it must be the bare token value.
 *  2. Failures come back as HTTP 200. A GSTIN that doesn't exist returns
 *     `{ code: 200, data: { error: { error_cd, message }, status_cd: "0" } }`,
 *     so checking response.ok proves nothing.
 *  3. The PAN endpoint requires a `state_code` QUERY parameter as well as the
 *     PAN in the body, because GST registration is per-state.
 */

const BASE_URL = 'https://api.sandbox.co.in'
const API_VERSION = '1.0.0'

/** The upstream is a government system behind an aggregator; it can be slow. */
const REQUEST_TIMEOUT_MS = 12_000

export interface GstAddress {
  bno?: string
  bnm?: string
  flno?: string
  st?: string
  loc?: string
  dst?: string
  /** State NAME, e.g. "Karnataka" — not the numeric code. */
  stcd?: string
  pncd?: string
  landMark?: string
}

export interface GstTaxpayer {
  gstin: string
  /** Legal name, as registered. */
  lgnm?: string
  /** Trade name — what customers know them as. */
  tradeNam?: string
  /** Registration type, e.g. "Regular", "Composition". */
  dty?: string
  /** Status, e.g. "Active", "Cancelled", "Suspended". */
  sts?: string
  /** Constitution of business: "Proprietorship", "Private Limited Company", … */
  ctb?: string
  /** Registration date, dd/mm/yyyy. */
  rgdt?: string
  /** Nature of business activities. */
  nba?: string[]
  pradr?: { addr?: GstAddress; ntr?: string }
}

export type SandboxResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: 'not_configured' | 'not_found' | 'invalid' | 'upstream'; message: string }

export function isSandboxConfigured(): boolean {
  return Boolean(process.env.SANDBOX_API_KEY && process.env.SANDBOX_API_SECRET)
}

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

let cachedToken: { value: string; expiresAt: number } | null = null

/**
 * Tokens last 24 hours. Caching them in module scope is worthwhile because
 * Fluid Compute reuses warm instances, so most onboarding requests skip the
 * extra round trip. It's a cache, never a source of truth: a 401 downstream
 * clears it and the next call re-authenticates.
 */
async function getAccessToken(): Promise<SandboxResult<string>> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return { ok: true, data: cachedToken.value }
  }

  const key = process.env.SANDBOX_API_KEY
  const secret = process.env.SANDBOX_API_SECRET

  if (!key || !secret) {
    return {
      ok: false,
      reason: 'not_configured',
      message: 'Sandbox API keys are not set. Add SANDBOX_API_KEY and SANDBOX_API_SECRET.',
    }
  }

  try {
    const response = await fetch(`${BASE_URL}/authenticate`, {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'x-api-secret': secret,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    const body = (await response.json()) as { data?: { access_token?: string }; message?: string }
    const token = body?.data?.access_token

    if (!token) {
      return {
        ok: false,
        reason: 'upstream',
        message: body?.message ?? 'Sandbox did not return an access token.',
      }
    }

    // Expire an hour early so a request never starts with a token that dies mid-flight.
    cachedToken = { value: token, expiresAt: Date.now() + 23 * 60 * 60 * 1000 }
    return { ok: true, data: token }
  } catch (cause) {
    return { ok: false, reason: 'upstream', message: describe(cause) }
  }
}

function describe(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') {
      return 'The GST service did not respond in time.'
    }
    return cause.message
  }
  return 'Could not reach the GST service.'
}

async function post<T>(
  path: string,
  body: Record<string, unknown>,
  retryOnAuthFailure = true,
): Promise<SandboxResult<T>> {
  const token = await getAccessToken()
  if (!token.ok) return token

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        // Bare token — a "Bearer " prefix is rejected by this API.
        authorization: token.data,
        'x-api-key': process.env.SANDBOX_API_KEY!,
        'x-api-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })

    if (response.status === 401 || response.status === 403) {
      cachedToken = null
      if (retryOnAuthFailure) return post<T>(path, body, false)
      return { ok: false, reason: 'upstream', message: 'GST service rejected our credentials.' }
    }

    if (response.status === 422) {
      return { ok: false, reason: 'invalid', message: 'That number is not in a valid format.' }
    }

    const payload = (await response.json()) as T
    return { ok: true, data: payload }
  } catch (cause) {
    return { ok: false, reason: 'upstream', message: describe(cause) }
  }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

interface SearchGstinResponse {
  code: number
  data?: {
    data?: GstTaxpayer
    error?: { error_cd?: string; message?: string }
    status_cd?: string
  }
  message?: string
}

/** Look up a single GSTIN and return the taxpayer record. */
export async function searchGstin(gstin: string): Promise<SandboxResult<GstTaxpayer>> {
  const result = await post<SearchGstinResponse>('/gst/compliance/public/gstin/search', {
    gstin: gstin.trim().toUpperCase(),
  })

  if (!result.ok) return result

  const payload = result.data?.data

  // status_cd "0" plus an error object is how this API says "no such GSTIN",
  // wrapped in an HTTP 200.
  if (!payload?.data || payload.error) {
    return {
      ok: false,
      reason: 'not_found',
      message: payload?.error?.message ?? 'No GST record found for that number.',
    }
  }

  return { ok: true, data: payload.data }
}

interface SearchPanResponse {
  code: number
  data?: Array<{ data?: GstTaxpayer }> | { error_code?: string; message?: string }
  message?: string
}

/**
 * List the GSTINs registered against a PAN in one state.
 *
 * The state is required by the API, and it's a genuine constraint rather than a
 * quirk: a business registers separately in each state it operates in, so "the
 * GSTINs for this PAN" is only answerable per state.
 */
export async function searchGstinsByPan(
  pan: string,
  stateCode: string,
): Promise<SandboxResult<GstTaxpayer[]>> {
  const result = await post<SearchPanResponse>(
    `/gst/compliance/public/pan/search?state_code=${encodeURIComponent(stateCode)}`,
    { pan: pan.trim().toUpperCase() },
  )

  if (!result.ok) return result

  const data = result.data?.data

  if (!Array.isArray(data)) {
    return {
      ok: false,
      reason: 'not_found',
      message: data?.message ?? 'No GST registrations found for that PAN in this state.',
    }
  }

  const taxpayers = data.map((entry) => entry.data).filter((t): t is GstTaxpayer => Boolean(t?.gstin))

  if (taxpayers.length === 0) {
    return { ok: false, reason: 'not_found', message: 'No GST registrations found for that PAN.' }
  }

  return { ok: true, data: taxpayers }
}

/** Exposed for tests — clears the module-scoped token cache. */
export function __resetTokenCache() {
  cachedToken = null
}
