'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { countryName } from '@/lib/locale/countries'
import { businessSchema, numberingSchema, paymentDetailsSchema } from '@/lib/validators'
import { toFieldErrors, type StepState } from '@/lib/form-state'

/** Empty strings from an untouched input should be null in the database, not "". */
function nullable(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim()
  return text.length ? text : null
}

/**
 * Read a form field as `string | undefined`.
 *
 * `formData.get()` returns **null** for a field the form doesn't contain, and
 * Zod's `.optional()` accepts `undefined` but rejects `null`. Passing the raw
 * result straight to the schema means any form that omits an optional field
 * fails validation — and the error lands under a field name that form doesn't
 * render, so the user sees "fix the highlighted fields" with nothing
 * highlighted. Every optional field must come through here.
 */
function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return value === null ? undefined : String(value)
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
    legal_name: field(formData, 'legal_name'),
    trade_name: field(formData, 'trade_name'),
    country_code: field(formData, 'country_code'),
    currency: field(formData, 'currency'),
    tax_id: field(formData, 'tax_id'),
    address_line1: field(formData, 'address_line1'),
    address_line2: field(formData, 'address_line2'),
    city: field(formData, 'city'),
    region: field(formData, 'region'),
    postal_code: field(formData, 'postal_code'),
    email: field(formData, 'email'),
    phone: field(formData, 'phone'),
    business_type: field(formData, 'business_type') || undefined,
  })

  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  const supabase = await createClient()
  const existing = await getPrimaryBusiness()

  const values = {
    owner_id: user.id,
    legal_name: parsed.data.legal_name,
    trade_name: parsed.data.trade_name ?? null,
    country_code: parsed.data.country_code,
    currency: parsed.data.currency,
    country: countryName(parsed.data.country_code),
    tax_id: parsed.data.tax_id ?? null,
    address_line1: parsed.data.address_line1,
    address_line2: parsed.data.address_line2 ?? null,
    city: parsed.data.city,
    region: parsed.data.region ?? null,
    postal_code: parsed.data.postal_code ?? null,
    email: parsed.data.email || null,
    phone: parsed.data.phone ?? null,
    business_type: parsed.data.business_type ?? null,
  }

  const { error } = existing
    ? await supabase.from('businesses').update(values).eq('id', existing.id)
    : await supabase.from('businesses').insert(values)

  if (error) return saveFailed(error)

  revalidatePath('/settings/business')
  // A guest fills this same form inline on /invoices/new; without this they
  // see "Saved." but stay on the form instead of reaching the builder.
  revalidatePath('/invoices/new')
  return { saved: true }
}

export async function persistPayment(formData: FormData): Promise<StepState> {
  const business = await getPrimaryBusiness()
  if (!business) return { error: 'Add your business details first.' }

  const parsed = paymentDetailsSchema.safeParse({
    bank_name: field(formData, 'bank_name'),
    account_name: field(formData, 'account_name'),
    account_number: field(formData, 'account_number'),
    routing_number: field(formData, 'routing_number'),
    default_terms: field(formData, 'default_terms'),
    default_notes: field(formData, 'default_notes'),
  })

  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  const supabase = await createClient()
  const { error } = await supabase
    .from('businesses')
    .update({
      bank_name: nullable(formData.get('bank_name')),
      account_name: nullable(formData.get('account_name')),
      account_number: nullable(formData.get('account_number')),
      routing_number: parsed.data.routing_number || null,
      default_terms: nullable(formData.get('default_terms')),
      default_notes: nullable(formData.get('default_notes')),
    })
    .eq('id', business.id)

  if (error) return saveFailed(error)

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

  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  const supabase = await createClient()
  const { error } = await supabase
    .from('businesses')
    .update({
      invoice_prefix: parsed.data.invoice_prefix,
      next_invoice_number: parsed.data.next_invoice_number,
    })
    .eq('id', business.id)

  if (error) return saveFailed(error)

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

/**
 * Database errors ("Could not find the 'country_code' column…") mean nothing to
 * the person filling the form, and leak schema details. Log the real one for us,
 * show them something they can act on.
 */
function saveFailed(error: { message: string }): { error: string } {
  console.error('[save failed]', error.message)
  return { error: "We couldn't save your details. Please try again in a moment." }
}
