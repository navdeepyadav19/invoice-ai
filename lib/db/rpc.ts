import { sql, type RawBuilder, type Selectable } from 'kysely'

import type { Db } from './index'
import type { WebhookDeliveries } from './schema'

/**
 * Typed wrappers for the SQL functions the app calls.
 *
 * On Supabase these were `supabase.rpc('name', { p_arg })`. Here each is one
 * function with real parameter and return types, so a renamed argument is a
 * compile error rather than a 404 from PostgREST at runtime.
 *
 * Two conventions:
 *  - jsonb arguments are passed through JSON.stringify. node-postgres would
 *    otherwise turn a JS array into a Postgres array literal, not JSON.
 *  - Errors are not caught here. Callers map them (fromPostgres) because only
 *    they know whether a failure is a 404, a 409 or a log line.
 */

const json = (value: unknown) => JSON.stringify(value ?? null)

async function scalar<T>(db: Db, query: RawBuilder<{ result: T }>): Promise<T> {
  const { rows } = await query.execute(db)
  return rows[0]!.result
}

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

/** Finalizes a draft atomically; returns the assigned invoice number. */
export function issueInvoice(db: Db, invoiceId: string, meta: Record<string, unknown>): Promise<string> {
  return scalar(db, sql<{ result: string }>`select public.issue_invoice(${invoiceId}::uuid, ${json(meta)}::jsonb) as result`)
}

/** Swaps every line item of a draft in one statement; returns the row count. */
export function replaceInvoiceItems(db: Db, invoiceId: string, items: unknown[]): Promise<number> {
  return scalar(db, sql<{ result: number }>`select public.replace_invoice_items(${invoiceId}::uuid, ${json(items)}::jsonb) as result`)
}

/** The whole public invoice surface: one unguessable token in, JSON out (or null). */
export function getPublicInvoice(db: Db, token: string): Promise<unknown> {
  return scalar(db, sql<{ result: unknown }>`select public.get_public_invoice(${token}::uuid) as result`)
}

export async function logPublicInvoiceEvent(db: Db, token: string, type: 'viewed' | 'downloaded'): Promise<void> {
  await sql`select public.log_public_invoice_event(${token}::uuid, ${type}::invoice_event_type)`.execute(db)
}

// ---------------------------------------------------------------------------
// API keys and idempotency
// ---------------------------------------------------------------------------

export interface ApiKeyLookup {
  id: string
  owner_id: string
  secret_hash: string
  scopes: string[]
  expires_at: string | null
  revoked_at: string | null
}

export async function apiKeyByPrefix(db: Db, prefix: string): Promise<ApiKeyLookup | null> {
  const { rows } = await sql<ApiKeyLookup>`select * from public.api_key_by_prefix(${prefix})`.execute(db)
  return rows[0] ?? null
}

export async function touchApiKey(db: Db, id: string): Promise<void> {
  await sql`select public.touch_api_key(${id}::uuid)`.execute(db)
}

export interface IdempotencyClaim {
  outcome: string
  response_status: number | null
  response_body: unknown
}

export async function claimIdempotencyKey(
  db: Db,
  input: { key: string; method: string; path: string; requestHash: string },
): Promise<IdempotencyClaim | null> {
  const { rows } = await sql<IdempotencyClaim>`
    select * from public.claim_idempotency_key(${input.key}, ${input.method}, ${input.path}, ${input.requestHash})
  `.execute(db)
  return rows[0] ?? null
}

export async function completeIdempotencyKey(db: Db, key: string, status: number, body: unknown): Promise<void> {
  await sql`select public.complete_idempotency_key(${key}, ${status}::integer, ${json(body)}::jsonb)`.execute(db)
}

export async function releaseIdempotencyKey(db: Db, key: string): Promise<void> {
  await sql`select public.release_idempotency_key(${key})`.execute(db)
}

// ---------------------------------------------------------------------------
// Email verification
// ---------------------------------------------------------------------------

export type CreateVerificationResult = 'created' | 'rate_limited' | 'already_verified' | 'no_email'

export function createEmailVerification(db: Db, tokenHash: string): Promise<CreateVerificationResult> {
  return scalar(db, sql<{ result: CreateVerificationResult }>`select public.create_email_verification(${tokenHash}) as result`)
}

export type RedeemVerificationResult = 'verified' | 'already_verified' | 'expired' | 'used' | 'email_changed' | 'invalid'

export function redeemEmailVerification(db: Db, tokenHash: string): Promise<RedeemVerificationResult> {
  return scalar(db, sql<{ result: RedeemVerificationResult }>`select public.redeem_email_verification(${tokenHash}) as result`)
}

/** Marks a Google sign-in's address verified when Neon Auth says Google verified it. */
export function syncOauthEmailVerification(db: Db): Promise<boolean> {
  return scalar(db, sql<{ result: boolean }>`select public.sync_oauth_email_verification() as result`)
}

// ---------------------------------------------------------------------------
// CLI device authorization (RFC 8628)
// ---------------------------------------------------------------------------

export function cliDeviceStart(
  db: Db,
  input: { deviceCodeHash: string; userCode: string; clientName: string; clientOs: string },
): Promise<string> {
  return scalar(
    db,
    sql<{ result: string }>`select public.cli_device_start(${input.deviceCodeHash}, ${input.userCode}, ${input.clientName}, ${input.clientOs}) as result`,
  )
}

export interface CliDeviceLookup {
  client_name: string
  client_os: string
  created_at: string
  expires_at: string
}

export async function cliDeviceLookup(db: Db, userCode: string): Promise<CliDeviceLookup | null> {
  const { rows } = await sql<CliDeviceLookup>`select * from public.cli_device_lookup(${userCode})`.execute(db)
  return rows[0] ?? null
}

export function cliDeviceDecide(db: Db, userCode: string, approve: boolean, scopes: string[]): Promise<string> {
  return scalar(
    db,
    sql<{ result: string }>`select public.cli_device_decide(${userCode}, ${approve}, ${scopes}::text[]) as result`,
  )
}

export interface CliDevicePoll {
  outcome: string
  owner_id: string | null
  scopes: string[] | null
  client_name: string | null
}

export async function cliDevicePoll(db: Db, deviceCodeHash: string): Promise<CliDevicePoll | null> {
  const { rows } = await sql<CliDevicePoll>`select * from public.cli_device_poll(${deviceCodeHash})`.execute(db)
  return rows[0] ?? null
}

export function cliDeviceAttachKey(db: Db, deviceCodeHash: string, apiKeyId: string): Promise<boolean> {
  return scalar(db, sql<{ result: boolean }>`select public.cli_device_attach_key(${deviceCodeHash}, ${apiKeyId}::uuid) as result`)
}

export function cliDeviceRelease(db: Db, deviceCodeHash: string): Promise<boolean> {
  return scalar(db, sql<{ result: boolean }>`select public.cli_device_release(${deviceCodeHash}) as result`)
}

// ---------------------------------------------------------------------------
// OAuth 2.1 (migration 0016)
//
// Every hash argument is hex(HMAC-SHA256) of the secret, 64 lowercase hex
// chars; the tables reject anything else. `clientUuid` / `p_client` is
// oauth_clients.id (from oauthClientLookup), never the wire client_id. Times
// go in as ISO strings.
// ---------------------------------------------------------------------------

export type OAuthRegisterResult = 'created' | 'rate_limited'

/** POST /oauth/register. Anon. Also sweeps stale OAuth rows. */
export function oauthRegisterClient(
  db: Db,
  input: {
    clientId: string
    secretHash: string | null
    authMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
    name: string
    clientUri: string | null
    redirectUris: string[]
    grantTypes: string[]
    metadata: unknown
  },
): Promise<OAuthRegisterResult> {
  return scalar(
    db,
    sql<{ result: OAuthRegisterResult }>`
      select public.oauth_register_client(
        ${input.clientId}, ${input.secretHash}, ${input.authMethod}, ${input.name}, ${input.clientUri},
        ${input.redirectUris}::text[], ${input.grantTypes}::text[], ${json(input.metadata)}::jsonb
      ) as result
    `,
  )
}

/** Upserts a fetched Client ID Metadata Document; returns oauth_clients.id. Anon. */
export function oauthCacheCimdClient(
  db: Db,
  input: {
    clientId: string
    name: string
    clientUri: string | null
    logoUri: string | null
    redirectUris: string[]
    metadata: unknown
    expiresAt: string
  },
): Promise<string> {
  return scalar(
    db,
    sql<{ result: string }>`
      select public.oauth_cache_cimd_client(
        ${input.clientId}, ${input.name}, ${input.clientUri}, ${input.logoUri},
        ${input.redirectUris}::text[], ${json(input.metadata)}::jsonb, ${input.expiresAt}::timestamptz
      ) as result
    `,
  )
}

export interface OAuthClientLookup {
  id: string
  client_id: string
  kind: 'dcr' | 'cimd'
  client_name: string
  client_uri: string | null
  logo_uri: string | null
  redirect_uris: string[]
  grant_types: string[]
  token_endpoint_auth_method: 'none' | 'client_secret_basic' | 'client_secret_post'
  client_secret_hash: string | null
  metadata_expires_at: string | null
}

export async function oauthClientLookup(db: Db, clientId: string): Promise<OAuthClientLookup | null> {
  const { rows } = await sql<OAuthClientLookup>`select * from public.oauth_client_lookup(${clientId})`.execute(db)
  return rows[0] ?? null
}

/** Approve: upserts the caller's grant and stores the code. Authenticated only; returns the code id (= family id). */
export function oauthAuthorize(
  db: Db,
  input: {
    clientUuid: string
    scopes: string[]
    codeHash: string
    redirectUri: string
    codeChallenge: string
    resource: string
  },
): Promise<string> {
  return scalar(
    db,
    sql<{ result: string }>`
      select public.oauth_authorize(
        ${input.clientUuid}::uuid, ${input.scopes}::text[], ${input.codeHash},
        ${input.redirectUri}, ${input.codeChallenge}, ${input.resource}
      ) as result
    `,
  )
}

export type OAuthExchangeOutcome = 'ok' | 'invalid' | 'expired' | 'reused' | 'revoked'

/** Fields are null unless outcome is 'ok'. */
export interface OAuthCodeExchange {
  outcome: OAuthExchangeOutcome
  code_id: string | null
  grant_id: string | null
  owner_id: string | null
  scopes: string[] | null
  redirect_uri: string | null
  code_challenge: string | null
  resource: string | null
}

/** Consumes the code (single use). Anon. A replayed code revokes its token family. */
export async function oauthExchangeCode(db: Db, codeHash: string, clientUuid: string): Promise<OAuthCodeExchange | null> {
  const { rows } = await sql<OAuthCodeExchange>`
    select * from public.oauth_exchange_code(${codeHash}, ${clientUuid}::uuid)
  `.execute(db)
  return rows[0] ?? null
}

/**
 * Mints the first pair for a just-exchanged code. Scopes, resource and grant
 * are copied from the code inside the function. Pass refreshHash null to mint
 * an access token only. Anon. False = refused (stale, replayed, revoked, or
 * already minted).
 */
export function oauthIssueTokens(
  db: Db,
  input: {
    familyId: string
    accessHash: string
    accessExpiresAt: string
    refreshHash: string | null
    refreshExpiresAt: string | null
  },
): Promise<boolean> {
  return scalar(
    db,
    sql<{ result: boolean }>`
      select public.oauth_issue_tokens(
        ${input.familyId}::uuid, ${input.accessHash}, ${input.accessExpiresAt}::timestamptz,
        ${input.refreshHash}, ${input.refreshExpiresAt}::timestamptz
      ) as result
    `,
  )
}

export type OAuthRotateOutcome = 'ok' | 'invalid' | 'expired' | 'revoked' | 'reused' | 'invalid_scope'

/** Fields are null unless outcome is 'ok'. */
export interface OAuthRefreshRotation {
  outcome: OAuthRotateOutcome
  grant_id: string | null
  owner_id: string | null
  scopes: string[] | null
  resource: string | null
}

/**
 * grant_type=refresh_token. Spends the old refresh token and mints a new pair.
 * `scopes` null (or empty) keeps the old token's scopes; it may only narrow.
 * Anon. A reused refresh token revokes its whole family.
 */
export async function oauthRotateRefresh(
  db: Db,
  input: {
    refreshHash: string
    clientUuid: string
    scopes: string[] | null
    accessHash: string
    accessExpiresAt: string
    newRefreshHash: string
    refreshExpiresAt: string
  },
): Promise<OAuthRefreshRotation | null> {
  const { rows } = await sql<OAuthRefreshRotation>`
    select * from public.oauth_rotate_refresh(
      ${input.refreshHash}, ${input.clientUuid}::uuid, ${input.scopes}::text[],
      ${input.accessHash}, ${input.accessExpiresAt}::timestamptz,
      ${input.newRefreshHash}, ${input.refreshExpiresAt}::timestamptz
    )
  `.execute(db)
  return rows[0] ?? null
}

/** Everything the bearer authenticator needs; it decides, this only reads. */
export interface OAuthTokenLookup {
  token_id: string
  kind: 'access' | 'refresh'
  grant_id: string
  owner_id: string
  client_uuid: string
  client_name: string
  scopes: string[]
  resource: string
  expires_at: string
  revoked_at: string | null
  grant_scopes: string[]
  grant_revoked_at: string | null
}

export async function oauthTokenLookup(db: Db, tokenHash: string): Promise<OAuthTokenLookup | null> {
  const { rows } = await sql<OAuthTokenLookup>`select * from public.oauth_token_lookup(${tokenHash})`.execute(db)
  return rows[0] ?? null
}

/** Fire-and-forget "last used", throttled to once a minute in SQL. */
export async function oauthTouchGrant(db: Db, grantId: string): Promise<void> {
  await sql`select public.oauth_touch_grant(${grantId}::uuid)`.execute(db)
}

/** RFC 7009. Unknown or another client's token is a silent no-op. Anon. */
export async function oauthRevokeToken(db: Db, tokenHash: string, clientUuid: string): Promise<void> {
  await sql`select public.oauth_revoke_token(${tokenHash}, ${clientUuid}::uuid)`.execute(db)
}

/** Settings → Revoke. Authenticated owner only; false if not theirs or already revoked. */
export function oauthRevokeGrant(db: Db, grantId: string): Promise<boolean> {
  return scalar(db, sql<{ result: boolean }>`select public.oauth_revoke_grant(${grantId}::uuid) as result`)
}

export interface OAuthGrantListItem {
  id: string
  client_uuid: string
  client_name: string
  client_kind: 'dcr' | 'cimd'
  client_id_text: string
  client_uri: string | null
  scopes: string[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/** The caller's connected apps, active first. Authenticated only. */
export async function oauthListGrants(db: Db, includeRevoked = false): Promise<OAuthGrantListItem[]> {
  const { rows } = await sql<OAuthGrantListItem>`select * from public.oauth_list_grants(${includeRevoked}::boolean)`.execute(db)
  return rows
}

// ---------------------------------------------------------------------------
// Webhook delivery worker — owner connection only (lib/db/system.ts)
// ---------------------------------------------------------------------------

export async function claimDueWebhookDeliveries(db: Db, limit: number): Promise<Selectable<WebhookDeliveries>[]> {
  const { rows } = await sql<Selectable<WebhookDeliveries>>`select * from public.claim_due_webhook_deliveries(${limit}::integer)`.execute(db)
  return rows
}

export async function finishWebhookDelivery(
  db: Db,
  input: { id: string; status: string; responseCode: number | null; error: string | null; nextAttemptAt: string | null },
): Promise<void> {
  await sql`
    select public.finish_webhook_delivery(
      ${input.id}::uuid, ${input.status}, ${input.responseCode}::integer, ${input.error}, ${input.nextAttemptAt}::timestamptz
    )
  `.execute(db)
}
