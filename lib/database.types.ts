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
export type InvoiceEventType = 'created' | 'sent' | 'viewed' | 'downloaded' | 'paid'

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
      redeem_merge_token: {
        Args: { p_token: string }
        Returns: number
      }
    }
    Enums: {
      invoice_status: InvoiceStatus
      invoice_event_type: InvoiceEventType
    }
    CompositeTypes: { [_ in never]: never }
  }
}
