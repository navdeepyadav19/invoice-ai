'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { businessSchema, numberingSchema, paymentDetailsSchema } from '@/lib/validators'
import { toFieldErrors, type StepState } from '@/lib/form-state'

/** Empty strings from an untouched input should be null in the database, not "". */
function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  return text.length ? text : null
}

/**
 * Pull the GST registry metadata that the lookup step posts as hidden fields.
 * Returns an empty object when absent, so a plain settings edit never blanks
 * out previously fetched registry data.
 */
function readGstMetadata(formData: FormData): Record<string, unknown> {
  const raw = formData.get('gst_data')
  if (!raw) return {}

  let parsed: unknown = null
  try {
    parsed = JSON.parse(String(raw))
  } catch {
    return {}
  }

  return {
    gst_data: parsed,
    gst_constitution: nullable(formData.get('gst_constitution')),
    gst_status: nullable(formData.get('gst_status')),
    gst_registered_on: nullable(formData.get('gst_registered_on')),
    gst_fetched_at: new Date().toISOString(),
  }
}

/**
 * The three persistence steps, shared by the onboarding wizard and the settings
 * page. They save and nothing else — no redirects, no step advancement — so the
 * caller decides what happens next. That's what keeps "finish setup" and "update
 * my details" from having to be two divergent copies of the same form logic.
 */

export async function persistBusiness(formData: FormData): Promise<StepState> {
  const user = await requireUser()

  const parsed = businessSchema.safeParse({
    legal_name: formData.get('legal_name'),
    trade_name: formData.get('trade_name'),
    is_gst_registered: formData.get('is_gst_registered') === 'on',
    gstin: formData.get('gstin'),
    pan: formData.get('pan'),
    address_line1: formData.get('address_line1'),
    address_line2: formData.get('address_line2'),
    city: formData.get('city'),
    state_code: formData.get('state_code'),
    pincode: formData.get('pincode'),
    country: formData.get('country') || 'India',
    email: formData.get('email'),
    phone: formData.get('phone'),
    business_type: formData.get('business_type') || undefined,
  })

  if (!parsed.success) return toFieldErrors(parsed.error)

  const supabase = await createClient()
  const existing = await getPrimaryBusiness()

  // Present only when this submission came from a successful GST lookup.
  const gstMeta = readGstMetadata(formData)

  const values = {
    owner_id: user.id,
    legal_name: parsed.data.legal_name,
    trade_name: parsed.data.trade_name ?? null,
    is_gst_registered: parsed.data.is_gst_registered,
    // Clearing the GSTIN when registration is switched off matters: the database
    // CHECK constraint ties the two together, and a stale GSTIN would keep tax
    // columns appearing on a Bill of Supply.
    gstin: parsed.data.is_gst_registered ? (parsed.data.gstin ?? null) : null,
    pan: parsed.data.pan || null,
    address_line1: parsed.data.address_line1,
    address_line2: parsed.data.address_line2 ?? null,
    city: parsed.data.city,
    state_code: parsed.data.state_code,
    pincode: parsed.data.pincode || null,
    country: parsed.data.country,
    email: parsed.data.email || null,
    phone: parsed.data.phone ?? null,
    business_type: parsed.data.business_type ?? null,
    ...gstMeta,
  }

  const { error } = existing
    ? await supabase.from('businesses').update(values).eq('id', existing.id)
    : await supabase.from('businesses').insert(values)

  if (error) return { error: error.message }

  revalidatePath('/settings/business')
  return { saved: true }
}

export async function persistPayment(formData: FormData): Promise<StepState> {
  const business = await getPrimaryBusiness()
  if (!business) return { error: 'Add your business details first.' }

  const parsed = paymentDetailsSchema.safeParse({
    bank_name: formData.get('bank_name'),
    account_name: formData.get('account_name'),
    account_number: formData.get('account_number'),
    ifsc: formData.get('ifsc'),
    upi_id: formData.get('upi_id'),
    default_terms: formData.get('default_terms'),
    default_notes: formData.get('default_notes'),
  })

  if (!parsed.success) return toFieldErrors(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase
    .from('businesses')
    .update({
      bank_name: nullable(formData.get('bank_name')),
      account_name: nullable(formData.get('account_name')),
      account_number: nullable(formData.get('account_number')),
      ifsc: parsed.data.ifsc || null,
      upi_id: parsed.data.upi_id || null,
      default_terms: nullable(formData.get('default_terms')),
      default_notes: nullable(formData.get('default_notes')),
    })
    .eq('id', business.id)

  if (error) return { error: error.message }

  revalidatePath('/settings/business')
  return { saved: true }
}

export async function persistNumbering(formData: FormData): Promise<StepState> {
  const business = await getPrimaryBusiness()
  if (!business) return { error: 'Add your business details first.' }

  const parsed = numberingSchema.safeParse({
    invoice_prefix: formData.get('invoice_prefix') || 'INV',
    next_invoice_number: formData.get('next_invoice_number') || 1,
  })

  if (!parsed.success) return toFieldErrors(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase
    .from('businesses')
    .update({
      invoice_prefix: parsed.data.invoice_prefix,
      next_invoice_number: parsed.data.next_invoice_number,
    })
    .eq('id', business.id)

  if (error) return { error: error.message }

  revalidatePath('/settings/business')
  return { saved: true }
}

/** Settings-page entry points: save, stay put, show a confirmation. */
export async function saveBusinessSettings(_prev: StepState, formData: FormData) {
  return persistBusiness(formData)
}

export async function savePaymentSettings(_prev: StepState, formData: FormData) {
  return persistPayment(formData)
}

export async function saveNumberingSettings(_prev: StepState, formData: FormData) {
  return persistNumbering(formData)
}
