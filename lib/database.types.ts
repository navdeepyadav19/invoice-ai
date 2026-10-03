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
