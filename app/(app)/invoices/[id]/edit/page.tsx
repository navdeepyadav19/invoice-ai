import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { InvoiceBuilder } from '@/components/invoice/builder'
import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { emptyLineItem, type InvoiceFormValues } from '@/lib/invoice-form'
import type { ClientRow, InvoiceItemRow, InvoiceRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Edit invoice' }

export default async function EditInvoicePage({ params }: PageProps<'/invoices/[id]/edit'>) {
  await requireUser()
  const { id } = await params

  const supabase = await createClient()
  const business = await getPrimaryBusiness()
  if (!business) redirect('/invoices/new')

  // RLS means a wrong id returns nothing rather than someone else's invoice, so
  // "not found" and "not yours" collapse into the same 404 — which is also the
  // right thing to tell an attacker probing for ids.
  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle<InvoiceRow>()

  if (!invoice) notFound()

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('position', { ascending: true })

  const { data: client } = invoice.client_id
    ? await supabase.from('clients').select('*').eq('id', invoice.client_id).maybeSingle<ClientRow>()
    : { data: null }

  return (
    <InvoiceBuilder
      business={business}
      invoiceId={invoice.id}
      invoiceNumber={invoice.invoice_number}
      status={invoice.status}
      initialValues={toFormValues(invoice, items ?? [], client ?? null)}
      aiEnabled={Boolean(process.env.OPENAI_API_KEY)}
    />
  )
}

function toFormValues(
  invoice: InvoiceRow,
  items: InvoiceItemRow[],
  client: ClientRow | null,
): InvoiceFormValues {
  return {
    client: {
      name: client?.name ?? '',
      tax_id: client?.tax_id ?? '',
      email: client?.email ?? '',
      phone: client?.phone ?? '',
      address_line1: client?.address_line1 ?? '',
      address_line2: client?.address_line2 ?? '',
      city: client?.city ?? '',
      region: client?.region ?? '',
      postal_code: client?.postal_code ?? client?.pincode ?? '',
      country_code: client?.country_code ?? '',
    },
    issue_date: invoice.issue_date,
    due_date: invoice.due_date ?? '',
    currency: invoice.currency,
    collection_method:
      invoice.collection_method === 'charge_automatically' ? 'charge_automatically' : 'send_invoice',
    notes: invoice.notes ?? '',
    terms: invoice.terms ?? '',
    items: items.length
      ? items.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unit: item.unit,
          rate: String(item.rate),
          discount_percent: String(item.discount_percent),
          tax_rate: String(item.tax_rate ?? item.gst_rate ?? 0),
        }))
      : [emptyLineItem()],
  }
}
