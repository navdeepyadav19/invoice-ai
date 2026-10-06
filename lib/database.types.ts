/**
 * Row types for the schema in db/migrations/.
 *
 * Hand-written, and the façade the UI imports: components want `InvoiceRow`,
 * not Kysely's `Selectable<Invoices>`. The query layer's own types are
 * generated from the live database into lib/db/schema.ts (`pnpm db:types`);
 * the two describe the same tables, and lib/db/schema-drift.test.ts fails if
 * a column is added to one and not the other.
 *
 * Shapes follow what lib/db/parsers.ts returns: timestamps and dates as ISO
 * strings, numeric money and int8 counts as numbers.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'overdue' | 'void'
// `open` means "finalized with an invoice number". The API name follows Stripe;
// the stored `sent_at` column keeps its historical name.
// `overdue` is derived from due_date at read time and is never stored.
export type InvoiceEventType =
  | 'created'
  | 'finalized'
  | 'viewed'
  | 'downloaded'
  | 'paid'
  | 'updated'
  | 'emailed'
  | 'email_failed'
  | 'voided'
  | 'payment_succeeded'
  | 'payment_failed'
  | 'refunded'
  | 'credited'
  | 'dispute_opened'
  | 'dispute_closed'

export type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  onboarding_step: number
  onboarding_completed_at: string | null
  /** Null = unverified. Only set server-side (migration 0012). */
  email_verified_at: string | null
  created_at: string
  updated_at: string
}

/** One emailed verification link. Never readable from a browser session (RLS, no policies). */
export type EmailVerificationRow = {
  id: string
  user_id: string
  email: string
  token_hash: string
  created_at: string
  expires_at: string
  used_at: string | null
}

export type BusinessRow = {
  id: string
  owner_id: string
  legal_name: string
  trade_name: string | null
  country_code: string
  currency: string
  tax_id: string | null
  region: string | null
  routing_number: string | null
  is_gst_registered: boolean
  gstin: string | null
  pan: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_code: string | null
  postal_code: string | null
  pincode: string | null
  country: string
  email: string | null
  phone: string | null
  logo_url: string | null
  signature_url: string | null
  bank_name: string | null
  account_name: string | null
  account_number: string | null
  ifsc: string | null
  upi_id: string | null
  default_notes: string | null
  default_terms: string | null
  invoice_prefix: string
  next_invoice_number: number
  business_type: string | null
  gst_constitution: string | null
  gst_status: string | null
  gst_registered_on: string | null
  gst_data: Json | null
  gst_fetched_at: string | null
  created_at: string
  updated_at: string
  /** Defaults copied onto each new invoice's payment_options (0017). */
  pay_online_default: boolean
  show_bank_details_default: boolean
  allow_partial_default: boolean
  partial_min_percent: number | null
}

export type ClientRow = {
  id: string
  public_id: string
  owner_id: string
  name: string
  tax_id: string | null
  country_code: string | null
  region: string | null
  postal_code: string | null
  gstin: string | null
  email: string | null
  phone: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_code: string | null
  pincode: string | null
  country: string
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type InvoiceRow = {
  id: string
  public_id: string
  owner_id: string
  business_id: string
  client_id: string | null
  invoice_number: string | null
  status: InvoiceStatus
  collection_method: string
  issue_date: string
  due_date: string | null
  currency: string
  place_of_supply_state_code: string | null
  is_export: boolean
  reverse_charge: boolean
  notes: string | null
  terms: string | null
  business_snapshot: Json | null
  client_snapshot: Json | null
  subtotal: number
  discount_total: number
  taxable_total: number
  tax_total: number
  cgst_total: number
  sgst_total: number
  igst_total: number
  cess_total: number
  round_off: number
  total: number
  amount_in_words: string | null
  public_token: string
  sent_at: string | null
  paid_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  updated_at: string
  /** How this invoice may be paid; copied from the business defaults (0017). */
  payment_options: InvoicePaymentOptions
  /** Net money applied: payments minus refunds, in major units. */
  amount_paid: number
  /** Amounts the merchant agreed are no longer owed (refund credits). */
  amount_credited: number
  has_test_payments: boolean
}

export type InvoicePaymentOptions = {
  online: boolean
  bank_details: boolean
  allow_partial: boolean
  partial_min_percent: number | null
}

export type InvoiceItemRow = {
  id: string
  public_id: string
  invoice_id: string
  position: number
  description: string
  hsn_sac: string | null
  quantity: number
  unit: string
  rate: number
  discount_percent: number
  taxable_value: number
  tax_rate: number
  tax_amount: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  cess_rate: number
  cess_amount: number
  line_total: number
  product_id: string | null
  price_id: string | null
}

export type ProductRow = {
  id: string
  public_id: string
  owner_id: string
  name: string
  description: string | null
  images: Json
  active: boolean
  created_at: string
  updated_at: string
}

export type PriceRecurringInterval = 'day' | 'week' | 'month' | 'year'

export type PriceRow = {
  id: string
  public_id: string
  owner_id: string
  product_id: string
  nickname: string | null
  unit_amount: number
  currency: string
  type: 'one_time' | 'recurring'
  recurring_interval: PriceRecurringInterval | null
  interval_count: number
  tax_rate: number
  active: boolean
  created_at: string
  updated_at: string
}

export type InvoiceEventRow = {
  id: string
  invoice_id: string
  type: InvoiceEventType
  meta: Json
  created_at: string
}

export type ApiKeyRow = {
  id: string
  owner_id: string
  name: string
  /** Public half, e.g. inv_live_ab12cd34. The secret is never stored. */
  prefix: string
  /** HMAC-SHA256(API_KEY_PEPPER, secret). See lib/auth/api-key.ts. */
  secret_hash: string
  scopes: string[]
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

/**
 * One CLI device-flow login (migration 0013). Never readable from a browser
 * session or an API key (RLS, no policies) — only through the cli_device_*
 * functions below.
 */
export type CliDeviceStatus = 'pending' | 'approved' | 'denied' | 'consumed' | 'expired'

export type CliDeviceCodeRow = {
  id: string
  /** hex(sha256(device_code)). The device code itself is never stored. */
  device_code_hash: string
  /** Normalised, dash-free: WXYZ2345. */
  user_code: string
  client_name: string
  client_os: string | null
  status: CliDeviceStatus
  owner_id: string | null
  scopes: string[]
  api_key_id: string | null
  created_at: string
  expires_at: string
  approved_at: string | null
  consumed_at: string | null
  last_polled_at: string | null
}

/*
 * OAuth 2.1 (migration 0016). None of these is readable from a browser session
 * except oauth_grants, and that only for its owner (RLS, SELECT only). Every
 * write, and every other read, goes through the oauth_* functions. Codes,
 * tokens and client secrets are stored as hex(HMAC-SHA256), never in the clear.
 */

export type OAuthClientKind = 'dcr' | 'cimd'
export type OAuthTokenEndpointAuthMethod = 'none' | 'client_secret_basic' | 'client_secret_post'

/** A DCR registration (client_id oc_…) or a cached CIMD document (client_id = its https URL). */
export type OAuthClientRow = {
  id: string
  client_id: string
  kind: OAuthClientKind
  client_name: string
  client_uri: string | null
  /** cimd only. DCR logos are attacker-chosen and never stored. */
  logo_uri: string | null
  redirect_uris: string[]
  grant_types: string[]
  token_endpoint_auth_method: OAuthTokenEndpointAuthMethod
  /** Null exactly when token_endpoint_auth_method is 'none'. */
  client_secret_hash: string | null
  metadata: Json | null
  /** cimd only: refetch the document after this. */
  metadata_expires_at: string | null
  created_at: string
  last_used_at: string | null
}

/** A connected app: one active grant per (owner, client). The ceiling for every token under it. */
export type OAuthGrantRow = {
  id: string
  owner_id: string
  /** oauth_clients.id (the uuid), not the wire client_id. */
  client_id: string
  scopes: string[]
  created_at: string
  updated_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/** Single-use, 5-minute code. Its id is the family id of every token minted from it. */
export type OAuthAuthorizationCodeRow = {
  id: string
  code_hash: string
  grant_id: string
  client_id: string
  owner_id: string
  redirect_uri: string
  /** base64url(sha256(verifier)), 43 chars. */
  code_challenge: string
  code_challenge_method: 'S256'
  scopes: string[]
  /** The audience the tokens will be bound to (RFC 8707). */
  resource: string
  created_at: string
  expires_at: string
  /** Set by the first redemption attempt with the right code and client, pass or fail. */
  consumed_at: string | null
  /** First time a consumed code was presented again (its family was revoked then). */
  replayed_at: string | null
}

export type OAuthTokenKind = 'access' | 'refresh'

export type OAuthTokenRow = {
  id: string
  token_hash: string
  kind: OAuthTokenKind
  grant_id: string
  /** The authorization code this lineage started from. */
  family_id: string
  /** The refresh token this one was rotated from. Null for the first pair. */
  parent_id: string | null
  scopes: string[]
  resource: string
  created_at: string
  expires_at: string
  /** Refresh tokens only: set when rotated. Seeing it again revokes the family. */
  used_at: string | null
  revoked_at: string | null
}

export type IdempotencyKeyRow = {
  owner_id: string
  key: string
  method: string
  path: string
  request_hash: string
  state: 'in_progress' | 'completed'
  response_status: number | null
  response_body: Json | null
  created_at: string
  expires_at: string
}

export type WebhookEndpointRow = {
  id: string
  owner_id: string
  url: string
  /** Shared with the subscriber. Unlike an API key this must stay recoverable — we sign with it. */
  secret: string
  /** Empty array means "all events". */
  events: string[]
  active: boolean
  failure_count: number
  disabled_at: string | null
  created_at: string
}

export type WebhookDeliveryRow = {
  id: string
  endpoint_id: string
  owner_id: string
  event_type: string
  payload: Json
  attempt: number
  status: 'pending' | 'succeeded' | 'failed' | 'dead'
  next_attempt_at: string
  response_code: number | null
  last_error: string | null
  created_at: string
}

export type ApiRequestRow = {
  id: string
  request_id: string
  owner_id: string
  via: 'session' | 'api_key' | 'oauth'
  api_key_id: string | null
  client_id: string | null
  method: string
  route: string
  status: number
  duration_ms: number
  idempotency_key: string | null
  ip_hash: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// Payments (0017)
// ---------------------------------------------------------------------------

export type PaymentProvider = 'manual' | 'stripe'
export type PaymentMode = 'test' | 'live'
export type PaymentStatus = 'pending' | 'succeeded' | 'failed' | 'refunded' | 'partially_refunded' | 'disputed'
export type PaymentAttention = 'overpaid' | 'invoice_void' | 'invoice_paid' | 'currency_mismatch'

export type PaymentConnectionRow = {
  id: string
  owner_id: string
  provider: 'stripe'
  mode: PaymentMode
  external_account_id: string
  status: 'active' | 'restricted' | 'disconnected'
  display_name: string | null
  country: string | null
  default_currency: string | null
  charges_ready: boolean
  connected_at: string
  disconnected_at: string | null
  updated_at: string
}

export type PaymentRow = {
  id: string
  public_id: string
  owner_id: string
  invoice_id: string
  provider: PaymentProvider
  mode: PaymentMode
  status: PaymentStatus
  amount: number
  currency: string
  amount_applied: number
  amount_refunded: number
  needs_attention: PaymentAttention | null
  external_payment_id: string | null
  checkout_session_id: string | null
  charge_id: string | null
  external_account_id: string | null
  method_type: string | null
  reference: string | null
  paid_at: string
  receipt_sent_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type RefundRow = {
  id: string
  public_id: string
  owner_id: string
  payment_id: string
  invoice_id: string
  amount: number
  reason: string | null
  client_still_owes: boolean
  status: 'pending' | 'succeeded' | 'failed'
  external_refund_id: string | null
  created_by: string | null
  created_at: string
}

export type InvoiceCreditRow = {
  id: string
  owner_id: string
  invoice_id: string
  amount: number
  reason: string | null
  refund_id: string | null
  created_by: string | null
  created_at: string
}

export type CheckoutSessionRow = {
  id: string
  owner_id: string
  invoice_id: string
  provider: 'stripe'
  mode: PaymentMode
  external_session_id: string
  external_account_id: string
  amount: number
  currency: string
  status: 'open' | 'complete' | 'expired'
  url: string | null
  expires_at: string
  created_at: string
}

export type ProviderEventRow = {
  provider: string
  event_id: string
  event_type: string
  received_at: string
  processed_at: string | null
}
