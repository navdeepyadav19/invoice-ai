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
