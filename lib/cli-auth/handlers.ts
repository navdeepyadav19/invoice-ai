import {
  DEVICE_CODE_TTL_SECONDS,
  POLL_INTERVAL_SECONDS,
  cliKeyName,
  formatUserCode,
  generateDeviceCode,
  generateUserCode,
  hashDeviceCode,
  isPlausibleDeviceCode,
  sanitiseClientField,
  tokenError,
  type PollOutcome,
  type TokenErrorCode,
} from '@/lib/cli-auth/device'
import { parseScopes, type Scope } from '@/lib/auth/scopes'

/**
 * HTTP logic for POST /api/cli/device and POST /api/cli/token.
 *
 * The database and the rate limiter arrive as arguments so the whole request →
 * response path can be tested without Supabase or Next (handlers.test.ts). The
 * real implementations are wired in lib/cli-auth/store.ts and the route files.
 */

// ---------------------------------------------------------------------------
// Dependencies
// ---------------------------------------------------------------------------

export interface PollResult {
  outcome: PollOutcome
  ownerId: string | null
  scopes: string[] | null
  clientName: string | null
}

/** Everything done AS the approving user, through RLS. */
export interface OwnerSession {
  createKey(input: { name: string; scopes: readonly Scope[] }): Promise<
    { ok: true; id: string; plaintext: string } | { ok: false; error: string }
  >
  attachKey(deviceCodeHash: string, keyId: string): Promise<void>
  /** Undo the poll's claim so the next poll can retry. */
  release(deviceCodeHash: string): Promise<void>
  account(): Promise<{ email: string | null; business_name: string | null }>
}

export interface DeviceStore {
  start(input: {
    deviceCodeHash: string
    userCode: string
    clientName: string
    clientOs: string | null
  }): Promise<'created' | 'collision' | 'rate_limited'>
  poll(deviceCodeHash: string): Promise<PollResult>
  asOwner(ownerId: string): Promise<OwnerSession>
}

export type RateLimiter = (
  key: string,
  bucket: string,
  rule: { limit: number; windowSeconds: number },
) => Promise<{ ok: boolean; retryAfter: number }>

export interface HandlerDeps {
  store: DeviceStore
  rateLimit: RateLimiter
  siteUrl: string
  /**
   * False when the deployment cannot issue API keys at all (no pepper or no
   * signing key — see lib/api/setup-status.ts). Checked before anything is
   * created or consumed, so a misconfigured server never burns an approval.
   */
  ready: () => boolean
  log?: (message: string, ...args: unknown[]) => void
}

const NOT_CONFIGURED = 'CLI login is not configured on this deployment (API keys are disabled).'

export const DEVICE_RATE_LIMIT = { limit: 10, windowSeconds: 60 }
/** One CLI polls 12 times a minute; this leaves room for a few behind one NAT. */
export const TOKEN_RATE_LIMIT = { limit: 60, windowSeconds: 60 }

// ---------------------------------------------------------------------------
// Response contracts (the CLI codes against these)
// ---------------------------------------------------------------------------

export interface DeviceResponse {
  device_code: string
  /** Formatted for display: `WXYZ-2345`. */
  user_code: string
  verification_uri: string
  verification_uri_complete: string
  interval: number
  expires_in: number
}

export interface TokenResponse {
  api_key: string
  key_id: string
  scopes: Scope[]
  account: { email: string | null; business_name: string | null }
}

// ---------------------------------------------------------------------------
// POST /api/cli/device
// ---------------------------------------------------------------------------

export async function handleDeviceRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const limited = await deps.rateLimit(clientIp(request), 'cli-device', DEVICE_RATE_LIMIT)
  if (!limited.ok) return errorResponse('rate_limited', { 'retry-after': String(limited.retryAfter) })

  if (!deps.ready()) return errorResponse('server_error', {}, NOT_CONFIGURED)

  const body = await readJsonObject(request)
  if (!body) return errorResponse('invalid_request', {}, 'Send a JSON object body.')

  const clientName = sanitiseClientField(body.client_name) ?? 'Unknown device'
  const clientOs = sanitiseClientField(body.client_os)

  // The user code is short, so a collision with another pending login is
  // possible (if astronomically unlikely); pick another and try again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const deviceCode = generateDeviceCode()
    const userCode = generateUserCode()

    let outcome: Awaited<ReturnType<DeviceStore['start']>>
    try {
      outcome = await deps.store.start({
        deviceCodeHash: hashDeviceCode(deviceCode),
        userCode,
        clientName,
        clientOs,
      })
    } catch (cause) {
      deps.log?.('[cli] could not start a device login', cause)
      return errorResponse('server_error')
    }

    if (outcome === 'rate_limited') return errorResponse('rate_limited', { 'retry-after': '60' })
    if (outcome === 'collision') continue

    const display = formatUserCode(userCode)
    const verificationUri = `${deps.siteUrl}/cli/authorize`

    const response: DeviceResponse = {
      device_code: deviceCode,
      user_code: display,
      verification_uri: verificationUri,
      verification_uri_complete: `${verificationUri}?code=${encodeURIComponent(display)}`,
      interval: POLL_INTERVAL_SECONDS,
      expires_in: DEVICE_CODE_TTL_SECONDS,
    }
    return jsonResponse(response, 200)
  }

  deps.log?.('[cli] could not allocate a unique user code after 5 attempts')
  return errorResponse('server_error')
}

// ---------------------------------------------------------------------------
// POST /api/cli/token
// ---------------------------------------------------------------------------

export async function handleTokenRequest(request: Request, deps: HandlerDeps): Promise<Response> {
  const limited = await deps.rateLimit(clientIp(request), 'cli-token', TOKEN_RATE_LIMIT)
  if (!limited.ok) return errorResponse('rate_limited', { 'retry-after': String(limited.retryAfter) })

  if (!deps.ready()) return errorResponse('server_error', {}, NOT_CONFIGURED)

  const body = await readJsonObject(request)
  if (!body || body.device_code === undefined) return errorResponse('invalid_request')

  // A malformed code can't match anything; answer exactly as for an unknown one.
  if (!isPlausibleDeviceCode(body.device_code)) return errorResponse('invalid_grant')

  const deviceCodeHash = hashDeviceCode(body.device_code)
  let polled: PollResult
  try {
    polled = await deps.store.poll(deviceCodeHash)
  } catch (cause) {
    deps.log?.('[cli] could not poll a device login', cause)
    return errorResponse('server_error')
  }

  if (polled.outcome !== 'approved') return errorResponse(polled.outcome)

  // This request won the row: it is now `consumed`, and no other poll can reach
  // this point for the same code. Mint the key as the approving user.
  const scopes = parseScopes(polled.scopes ?? [])
  if (!polled.ownerId || !scopes.length) {
    deps.log?.('[cli] approved device code without owner or scopes')
    return errorResponse('server_error')
  }

  let owner: OwnerSession
  try {
    owner = await deps.store.asOwner(polled.ownerId)
  } catch (cause) {
    // Cannot even act as the owner, so the claim cannot be released either;
    // the CLI will see invalid_grant next and must start again. `ready()`
    // makes this unreachable in practice.
    deps.log?.('[cli] could not act as owner to mint a CLI key', cause)
    return errorResponse('server_error')
  }

  let created: Awaited<ReturnType<OwnerSession['createKey']>>
  try {
    created = await owner.createKey({ name: cliKeyName(polled.clientName), scopes })
  } catch (cause) {
    created = { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
  }

  if (!created.ok) {
    deps.log?.('[cli] key insert failed: %s', created.error)
    // Put the row back to `approved` so the CLI's next poll retries the mint
    // rather than being told the code is spent.
    await owner.release(deviceCodeHash).catch(() => undefined)
    return errorResponse('server_error')
  }

  // Bookkeeping only; the key exists and is the user's either way.
  await owner.attachKey(deviceCodeHash, created.id).catch((cause) => {
    deps.log?.('[cli] could not attach key to device code', cause)
  })

  const account = await owner.account().catch(() => ({ email: null, business_name: null }))

  const response: TokenResponse = {
    api_key: created.plaintext,
    key_id: created.id,
    scopes,
    account,
  }
  return jsonResponse(response, 200)
}

// ---------------------------------------------------------------------------

/**
 * The caller's address for per-IP limiting. On Vercel the platform sets
 * x-forwarded-for, so the first entry is the client as the edge saw it.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const text = await request.text().catch(() => '')
  if (!text.trim()) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // RFC 6749 §5.1: responses carrying credentials must not be cached by
      // anything in between.
      'cache-control': 'no-store',
      pragma: 'no-cache',
      ...headers,
    },
  })
}

function errorResponse(
  code: TokenErrorCode,
  headers: Record<string, string> = {},
  description?: string,
): Response {
  const { status, body } = tokenError(code)
  return jsonResponse(description ? { ...body, error_description: description } : body, status, headers)
}
