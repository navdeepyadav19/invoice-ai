import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { InvoiceBuilder, type LinkedCustomer } from '@/components/invoice/builder'
import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { emptyLineItem, type InvoiceFormValues } from '@/lib/invoice-form'
import { pickerAvailability } from '@/lib/catalog/availability'
import { formatPriceLabel, isSavedCustomerLink } from '@/lib/catalog/picker'
import type { ClientRow, InvoiceItemRow, InvoiceRow, PriceRow } from '@/lib/database.types'

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

  const rows = (items ?? []) as InvoiceItemRow[]

  // Catalog links on the lines, so a re-save keeps them (price_… refs) and the
  // builder can badge them and flag a currency change.
  const priceIds = [...new Set(rows.map((item) => item.price_id).filter((v): v is string => Boolean(v)))]
  const pricesById = new Map<string, PriceMeta>()
  if (priceIds.length > 0) {
    const { data: prices } = await supabase
      .from('prices')
      .select('*, products(name)')
      .in('id', priceIds)
    for (const row of (prices ?? []) as unknown as Array<PriceRow & { products: unknown }>) {
      pricesById.set(row.id, {
        publicId: row.public_id,
        currency: row.currency,
        label: formatPriceLabel({
          unitAmount: Number(row.unit_amount),
          currency: row.currency,
          type: row.type,
          interval: row.recurring_interval,
          intervalCount: Number(row.interval_count) || 1,
        }),
      })
    }
  }

  const initialValues = toFormValues(invoice, rows, client ?? null, pricesById)

  return (
    <InvoiceBuilder
      business={business}
      invoiceId={invoice.id}
      invoiceNumber={invoice.invoice_number}
      status={invoice.status}
      initialValues={initialValues}
      aiEnabled={Boolean(process.env.OPENAI_API_KEY)}
      pickers={invoice.status === 'draft' ? await pickerAvailability() : undefined}
      initialCustomer={
        invoice.status === 'draft' && client
          ? await savedCustomerLink(supabase, invoice, client, initialValues.client)
          : null
      }
    />
  )
}

interface PriceMeta {
  publicId: string
  currency: string
  label: string
}

/**
 * Does this draft bill a saved customer (show the chip; edits detach) or its
 * own snapshot row (edits update it in place, as before)? See
 * isSavedCustomerLink for the rule.
 */
async function savedCustomerLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  invoice: InvoiceRow,
  client: ClientRow,
  snapshot: InvoiceFormValues['client'],
): Promise<LinkedCustomer | null> {
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('client_id', client.id)
    .neq('id', invoice.id)

  const saved = isSavedCustomerLink({
    clientCreatedAt: client.created_at,
    invoiceCreatedAt: invoice.created_at,
    otherInvoiceCount: count ?? 0,
  })

  return saved ? { id: client.public_id, snapshot } : null
}

function toFormValues(
  invoice: InvoiceRow,
  items: InvoiceItemRow[],
  client: ClientRow | null,
  pricesById: Map<string, PriceMeta> = new Map(),
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
      ? items.map((item) => {
          const price = item.price_id ? pricesById.get(item.price_id) : undefined
          return {
            description: item.description,
            quantity: String(item.quantity),
            unit: item.unit,
            rate: String(item.rate),
            discount_percent: String(item.discount_percent),
            tax_rate: String(item.tax_rate ?? item.gst_rate ?? 0),
            ...(price
              ? { price: price.publicId, price_currency: price.currency, price_label: price.label }
              : {}),
          }
        })
      : [emptyLineItem()],
  }
}
