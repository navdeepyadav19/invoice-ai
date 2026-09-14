'use server'

import { revalidatePath } from 'next/cache'

import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/queries'
import { viewFromRows } from '@/lib/invoice-load'
import { renderInvoicePdf, pdfFilename } from '@/lib/pdf'
import { sendInvoiceEmail } from '@/lib/email'
import { publicInvoiceUrl } from '@/lib/urls'
import type { SendState } from '@/lib/send-state'
import type { InvoiceRow } from '@/lib/database.types'

/**
 * Issue an invoice.
 *
 * Three things happen here that don't happen anywhere else:
 *
 *  1. The invoice number is claimed. Not before — a number assigned at draft
 *     creation is a number wasted if the draft is abandoned, and gaps in a GST
 *     series are what an audit asks about. claim_invoice_number takes a row lock
 *     so two simultaneous sends can't collect the same one.
 *  2. The status moves draft -> sent, which is one-way. saveInvoiceDraft filters
 *     on status = 'draft', so from this point the document is frozen.
 *  3. Optionally, the client gets an email with the PDF attached.
 */
export async function sendInvoiceAction(
  invoiceId: string,
  options: { email?: boolean } = {},
): Promise<SendState> {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle<InvoiceRow>()

  if (!invoice) return { error: 'Invoice not found.' }
  if (invoice.status === 'cancelled') return { error: 'This invoice was cancelled.' }

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('position', { ascending: true })

  if (!items?.length) return { error: 'Add at least one line item before sending.' }

  // Idempotent: re-sending an already-numbered invoice keeps its number.
  let invoiceNumber = invoice.invoice_number

  if (!invoiceNumber) {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_invoice_number', {
      p_business_id: invoice.business_id,
    })

    if (claimError || !claimed) {
      return { error: claimError?.message ?? 'Could not assign an invoice number.' }
    }

    invoiceNumber = claimed
  }

  const { error: updateError } = await supabase
    .from('invoices')
    .update({
      invoice_number: invoiceNumber,
      status: invoice.status === 'draft' ? 'sent' : invoice.status,
      sent_at: invoice.sent_at ?? new Date().toISOString(),
    })
    .eq('id', invoiceId)
    .eq('owner_id', user.id)

  if (updateError) return { error: updateError.message }

  await supabase.from('invoice_events').insert({ invoice_id: invoiceId, type: 'sent' })

  const publicUrl = publicInvoiceUrl(invoice.public_token)
  let emailed = false

  if (options.email) {
    const view = viewFromRows({ ...invoice, invoice_number: invoiceNumber, status: 'sent' }, items)
    const recipient = view.client.email

    if (!recipient) {
      // The invoice is issued either way — refusing to send it because we
      // couldn't email would leave the user with a numbered draft and no way out.
      return {
        publicUrl,
        invoiceNumber,
        error: 'Invoice issued, but there is no client email address to send it to.',
      }
    }

    try {
      const pdf = await renderInvoicePdf(view)

      await sendInvoiceEmail({
        to: recipient,
        view,
        publicUrl,
        pdf,
        filename: pdfFilename(view),
      })

      emailed = true
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not send the email.'
      return { publicUrl, invoiceNumber, error: `Invoice issued, but the email failed: ${message}` }
    }
  }

  revalidatePath('/dashboard')
  revalidatePath(`/invoices/${invoiceId}/edit`)

  return { publicUrl, invoiceNumber, emailed }
}

/** Mark an issued invoice as paid. */
export async function markPaidAction(invoiceId: string): Promise<SendState> {
  const user = await requireUser()
  const supabase = await createClient()

  const { error } = await supabase
    .from('invoices')
    .update({ status: 'paid', paid_at: new Date().toISOString() })
    .eq('id', invoiceId)
    .eq('owner_id', user.id)
    .neq('status', 'draft')

  if (error) return { error: error.message }

  await supabase.from('invoice_events').insert({ invoice_id: invoiceId, type: 'paid' })

  revalidatePath('/dashboard')
  revalidatePath(`/invoices/${invoiceId}/edit`)

  return {}
}
