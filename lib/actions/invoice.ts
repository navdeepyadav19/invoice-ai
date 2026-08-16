'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { invoiceSchema } from '@/lib/validators'
import { computeInvoice, type GstLineInput } from '@/lib/gst'
import { toRupees } from '@/lib/money'
import { snapshotBusiness } from '@/lib/invoice-view'
import { toFieldErrors } from '@/lib/form-state'
import type { InvoiceInput } from '@/lib/validators'

export interface SaveInvoiceState {
  error?: string
  fieldErrors?: Record<string, string>
  invoiceId?: string
  savedAt?: string
}

/**
 * Save (or create) a draft.
 *
 * The server recomputes every total from the submitted line items and ignores
 * anything the client claimed. A tampered request can change what is billed —
 * that's the customer's own invoice — but it can never produce a document whose
 * tax doesn't follow from its own line items, which is the part that has to hold
 * up against a filing.
 */
export async function saveInvoiceDraft(
  input: InvoiceInput & { id?: string },
): Promise<SaveInvoiceState> {
  const user = await requireUser()
  const business = await getPrimaryBusiness()

  if (!business) {
    return { error: 'Add your business details before saving an invoice.' }
  }

  // No formData to echo: the builder posts a typed object and keeps its own
  // react-hook-form state, so nothing is lost on a failed validation.
  const parsed = invoiceSchema.safeParse(input)
  if (!parsed.success) return toFieldErrors(parsed.error)

  const data = parsed.data
  const supabase = await createClient()

  /**
   * Refuse outright once an invoice has been issued.
   *
   * This used to rely on `.eq('status', 'draft')` on the header UPDATE, which
   * is not a guard on the *operation*: the line items are replaced by a
   * separate delete+insert that had no such filter. Editing a sent invoice
   * therefore left the header totals frozen while the line items changed
   * underneath them — a document that no longer adds up, saved silently.
   *
   * Checking once, up front, is the only version that can't half-apply.
   */
  if (input.id) {
    const { data: existing } = await supabase
      .from('invoices')
      .select('status')
      .eq('id', input.id)
      .maybeSingle()

    if (!existing) {
      return { error: 'That invoice no longer exists.' }
    }

    if (existing.status !== 'draft') {
      return {
        error: 'This invoice has already been issued, so it can no longer be edited.',
      }
    }
  }

  const lines: GstLineInput[] = data.items.map((item) => ({
    description: item.description,
    hsnSac: item.hsn_sac || undefined,
    quantity: item.quantity,
    unit: item.unit,
    rate: item.rate,
    discountPercent: item.discount_percent,
    gstRate: item.gst_rate,
    cessRate: item.cess_rate,
  }))

  const computed = computeInvoice(
    {
      supplierStateCode: business.state_code,
      placeOfSupplyStateCode: data.place_of_supply_state_code,
      supplierIsGstRegistered: business.is_gst_registered,
      isExport: data.is_export,
      reverseCharge: data.reverse_charge,
      lines,
    },
    data.currency,
  )

  // Upsert the client so it can be reused, and so the invoice can reference it.
  const clientValues = {
    owner_id: user.id,
    name: data.client.name,
    gstin: data.client.gstin || null,
    email: data.client.email || null,
    phone: data.client.phone ?? null,
    address_line1: data.client.address_line1 ?? null,
    address_line2: data.client.address_line2 ?? null,
    city: data.client.city ?? null,
    state_code: data.client.state_code || null,
    pincode: data.client.pincode || null,
    country: data.client.country,
  }

  // Reuse the client row this draft already points at. Inserting on every save
  // would leave a trail of near-identical clients behind an autosaving form.
  let clientId: string | null = null

  if (input.id) {
    const { data: existing } = await supabase
      .from('invoices')
      .select('client_id')
      .eq('id', input.id)
      .maybeSingle()
    clientId = existing?.client_id ?? null
  }

  if (clientId) {
    const { error } = await supabase.from('clients').update(clientValues).eq('id', clientId)
    if (error) return { error: error.message }
  } else {
    const { data: created, error } = await supabase
      .from('clients')
      .insert(clientValues)
      .select('id')
      .single()
    if (error) return { error: error.message }
    clientId = created.id
  }

  const invoiceValues = {
    owner_id: user.id,
    business_id: business.id,
    client_id: clientId,
    status: 'draft' as const,
    issue_date: data.issue_date,
    due_date: data.due_date || null,
    currency: data.currency,
    place_of_supply_state_code: data.place_of_supply_state_code,
    is_export: data.is_export,
    reverse_charge: data.reverse_charge,
    notes: data.notes ?? null,
    terms: data.terms ?? null,
    business_snapshot: snapshotBusiness(business),
    client_snapshot: { ...clientValues, owner_id: undefined },
    subtotal: toRupees(computed.subtotalPaise),
    discount_total: toRupees(computed.discountTotalPaise),
    taxable_total: toRupees(computed.taxableTotalPaise),
    cgst_total: toRupees(computed.cgstTotalPaise),
    sgst_total: toRupees(computed.sgstTotalPaise),
    igst_total: toRupees(computed.igstTotalPaise),
    cess_total: toRupees(computed.cessTotalPaise),
    round_off: toRupees(computed.roundOffPaise),
    total: toRupees(computed.totalPaise),
    amount_in_words: computed.amountInWords,
  }

  let invoiceId = input.id

  if (invoiceId) {
    const { error } = await supabase
      .from('invoices')
      .update(invoiceValues)
      .eq('id', invoiceId)
      .eq('status', 'draft') // never rewrite an invoice that has already gone out
    if (error) return { error: error.message }
  } else {
    const { data: created, error } = await supabase
      .from('invoices')
      .insert(invoiceValues)
      .select('id')
      .single()
    if (error) return { error: error.message }
    invoiceId = created.id
  }

  // Line items are replaced wholesale rather than diffed. Rows carry no identity
  // the user cares about, and a delete+insert inside one save keeps positions
  // correct without reconciling adds, removes and reorders.
  await supabase.from('invoice_items').delete().eq('invoice_id', invoiceId)

  const { error: itemsError } = await supabase.from('invoice_items').insert(
    computed.lines.map((line, index) => ({
      invoice_id: invoiceId!,
      position: index,
      description: line.description,
      hsn_sac: line.hsnSac ?? null,
      quantity: line.quantity,
      unit: line.unit,
      rate: line.rate,
      discount_percent: line.discountPercent,
      taxable_value: toRupees(line.taxablePaise),
      gst_rate: line.gstRate,
      cgst_amount: toRupees(line.cgstPaise),
      sgst_amount: toRupees(line.sgstPaise),
      igst_amount: toRupees(line.igstPaise),
      cess_rate: line.cessRate ?? 0,
      cess_amount: toRupees(line.cessPaise),
      line_total: toRupees(line.totalPaise),
    })),
  )

  if (itemsError) return { error: itemsError.message }

  revalidatePath('/dashboard')

  return { invoiceId, savedAt: new Date().toISOString() }
}
