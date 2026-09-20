/**
 * Types for the schema in supabase/migrations/0001_init.sql.
 *
 * Hand-written to match the migration so the app typechecks before a Supabase
 * project exists. Once you have one, regenerate to keep them honest:
 *
 *   pnpm dlx supabase gen types typescript --project-id <ref> > lib/database.types.ts
 *
 * Every row type below MUST be a `type` alias, never an `interface`.
 * postgrest-js constrains rows to `Record<string, unknown>`; interfaces have no
 * implicit index signature, so an interface silently fails that constraint, the
 * schema stops matching GenericSchema, and every .insert()/.update() argument
 * degrades to `never` with an error that points at the call site rather than
 * here. Type aliases satisfy it, which is why the generator emits them.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled'
// `sent` means "assigned a GST number". The API renames it to `invoice.issued`
// at the edge, because being issued and being emailed are different facts —
// which is what `emailed` / `email_failed` are for.
export type InvoiceEventType =
  | 'created'
  | 'sent'
  | 'viewed'
  | 'downloaded'
  | 'paid'
  | 'updated'
  | 'emailed'
  | 'email_failed'
  | 'cancelled'

export type ProfileRow = {
  id: string
  email: string | null
  full_name: string | null
  onboarding_step: number
  onboarding_completed_at: string | null
  created_at: string
  updated_at: string
}

export type BusinessRow = {
  id: string
  owner_id: string
  legal_name: string
  trade_name: string | null
  is_gst_registered: boolean
  gstin: string | null
  pan: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state_code: string
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
  owner_id: string
  name: string
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
  owner_id: string
  business_id: string
  client_id: string | null
  invoice_number: string | null
  status: InvoiceStatus
  issue_date: string
  due_date: string | null
  currency: string
  place_of_supply_state_code: string
  is_export: boolean
  reverse_charge: boolean
  notes: string | null
  terms: string | null
  business_snapshot: Json | null
  client_snapshot: Json | null
  subtotal: number
  discount_total: number
  taxable_total: number
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
  invoice_id: string
  position: number
  description: string
  hsn_sac: string | null
  quantity: number
  unit: string
  rate: number
  discount_percent: number
  taxable_value: number
  gst_rate: number
  cgst_amount: number
  sgst_amount: number
  igst_amount: number
  cess_rate: number
  cess_amount: number
  line_total: number
}

export type MergeTokenRow = {
  token: string
  owner_id: string
  created_at: string
  expires_at: string
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

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow>
      businesses: Table<BusinessRow, Omit<Partial<BusinessRow>, 'owner_id' | 'legal_name' | 'state_code'> & Pick<BusinessRow, 'owner_id' | 'legal_name' | 'state_code'>>
      clients: Table<ClientRow, Omit<Partial<ClientRow>, 'owner_id' | 'name'> & Pick<ClientRow, 'owner_id' | 'name'>>
      invoices: Table<
        InvoiceRow,
        Omit<Partial<InvoiceRow>, 'owner_id' | 'business_id' | 'place_of_supply_state_code'> &
          Pick<InvoiceRow, 'owner_id' | 'business_id' | 'place_of_supply_state_code'>
      >
      invoice_items: Table<
        InvoiceItemRow,
        Omit<Partial<InvoiceItemRow>, 'invoice_id' | 'description'> &
          Pick<InvoiceItemRow, 'invoice_id' | 'description'>
      >
      invoice_events: Table<
        InvoiceEventRow,
        Omit<Partial<InvoiceEventRow>, 'invoice_id' | 'type'> & Pick<InvoiceEventRow, 'invoice_id' | 'type'>
      >
      merge_tokens: Table<
        MergeTokenRow,
        Omit<Partial<MergeTokenRow>, 'owner_id'> & Pick<MergeTokenRow, 'owner_id'>
      >
      api_keys: Table<
        ApiKeyRow,
        Omit<Partial<ApiKeyRow>, 'owner_id' | 'name' | 'prefix' | 'secret_hash' | 'scopes'> &
          Pick<ApiKeyRow, 'owner_id' | 'name' | 'prefix' | 'secret_hash' | 'scopes'>
      >
      idempotency_keys: Table<
        IdempotencyKeyRow,
        Omit<Partial<IdempotencyKeyRow>, 'owner_id' | 'key' | 'method' | 'path' | 'request_hash'> &
          Pick<IdempotencyKeyRow, 'owner_id' | 'key' | 'method' | 'path' | 'request_hash'>
      >
      webhook_endpoints: Table<
        WebhookEndpointRow,
        Omit<Partial<WebhookEndpointRow>, 'owner_id' | 'url' | 'secret'> &
          Pick<WebhookEndpointRow, 'owner_id' | 'url' | 'secret'>
      >
      webhook_deliveries: Table<
        WebhookDeliveryRow,
        Omit<Partial<WebhookDeliveryRow>, 'endpoint_id' | 'owner_id' | 'event_type' | 'payload'> &
          Pick<WebhookDeliveryRow, 'endpoint_id' | 'owner_id' | 'event_type' | 'payload'>
      >
      api_requests: Table<
        ApiRequestRow,
        Omit<
          Partial<ApiRequestRow>,
          'request_id' | 'owner_id' | 'via' | 'method' | 'route' | 'status' | 'duration_ms'
        > &
          Pick<
            ApiRequestRow,
            'request_id' | 'owner_id' | 'via' | 'method' | 'route' | 'status' | 'duration_ms'
          >
      >
    }
    // Must be an EMPTY mapped type, not Record<string, never>. postgrest-js
    // resolves .from() against `Tables & Views`, so a Record<string, never>
    // intersects every table down to `never` and every insert/update silently
    // stops type-checking.
    Views: { [_ in never]: never }
    Functions: {
      get_public_invoice: {
        Args: { p_token: string }
        Returns: Json
      }
      log_public_invoice_event: {
        Args: { p_token: string; p_type: InvoiceEventType }
        Returns: undefined
      }
      claim_invoice_number: {
        Args: { p_business_id: string }
        Returns: string
      }
      issue_invoice: {
        Args: { p_invoice_id: string; p_meta?: Json }
        Returns: string
      }
      replace_invoice_items: {
        Args: { p_invoice_id: string; p_items: Json }
        Returns: number
      }
      redeem_merge_token: {
        Args: { p_token: string }
        Returns: number
      }
      api_key_by_prefix: {
        Args: { p_prefix: string }
        Returns: {
          id: string
          owner_id: string
          secret_hash: string
          scopes: string[]
          expires_at: string | null
          revoked_at: string | null
        }[]
      }
      touch_api_key: {
        Args: { p_id: string }
        Returns: undefined
      }
      claim_idempotency_key: {
        Args: { p_key: string; p_method: string; p_path: string; p_request_hash: string }
        Returns: {
          outcome: 'claimed' | 'replay' | 'in_progress' | 'mismatch'
          response_status: number | null
          response_body: Json | null
        }[]
      }
      complete_idempotency_key: {
        Args: { p_key: string; p_status: number; p_body: Json }
        Returns: undefined
      }
      release_idempotency_key: {
        Args: { p_key: string }
        Returns: undefined
      }
      cleanup_api_runtime: {
        Args: { p_days?: number }
        Returns: number
      }
      claim_due_webhook_deliveries: {
        Args: { p_limit?: number }
        Returns: WebhookDeliveryRow[]
      }
      finish_webhook_delivery: {
        Args: {
          p_id: string
          p_status: string
          p_response_code: number | null
          p_error: string | null
          p_next_attempt_at: string | null
        }
        Returns: undefined
      }
    }
    Enums: {
      invoice_status: InvoiceStatus
      invoice_event_type: InvoiceEventType
    }
    CompositeTypes: { [_ in never]: never }
  }
}
