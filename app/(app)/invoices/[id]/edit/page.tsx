import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { InvoiceBuilder, type LinkedCustomer } from '@/components/invoice/builder'
import { isUuid } from '@/lib/catalog/ids'
import type { Db } from '@/lib/db'
import { getPrimaryBusiness, requireUser, sessionDb } from '@/lib/queries'
import { emptyLineItem, type InvoiceFormValues } from '@/lib/invoice-form'
import { pickerAvailability } from '@/lib/catalog/availability'
import { formatPriceLabel, isSavedCustomerLink } from '@/lib/catalog/picker'
import type { ClientRow, InvoiceItemRow, InvoiceRow, PriceRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Edit invoice' }

export default async function EditInvoicePage({ params }: PageProps<'/invoices/[id]/edit'>) {
  await requireUser()
  const { id } = await params
  // Not a uuid → cannot be an invoice; 404 rather than a Postgres cast error.
  if (!isUuid(id)) notFound()

  const db = await sessionDb()
  const business = await getPrimaryBusiness()
  if (!business) redirect('/invoices/new')

  // RLS means a wrong id returns nothing rather than someone else's invoice, so
  // "not found" and "not yours" collapse into the same 404 — which is also the
  // right thing to tell an attacker probing for ids.
  const invoice = (await db.selectFrom('invoices').selectAll().where('id', '=', id).executeTakeFirst()) as
    | InvoiceRow
    | undefined

  if (!invoice) notFound()

  const rows = (await db
    .selectFrom('invoice_items')
    .selectAll()
    .where('invoice_id', '=', id)
    .orderBy('position', 'asc')
    .execute()) as InvoiceItemRow[]

  const client = invoice.client_id
    ? ((await db.selectFrom('clients').selectAll().where('id', '=', invoice.client_id).executeTakeFirst()) as
        | ClientRow
        | undefined)
    : undefined

  // Catalog links on the lines, so a re-save keeps them (price_… refs) and the
  // builder can badge them and flag a currency change.
  const priceIds = [...new Set(rows.map((item) => item.price_id).filter((v): v is string => Boolean(v)))]
  const pricesById = new Map<string, PriceMeta>()
  if (priceIds.length > 0) {
    const prices = (await db
      .selectFrom('prices')
      .leftJoin('products', 'products.id', 'prices.product_id')
      .selectAll('prices')
      .select('products.name as product_name')
      .where('prices.id', 'in', priceIds)
      .execute()) as unknown as Array<PriceRow & { product_name: string | null }>
    for (const row of prices) {
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
          ? await savedCustomerLink(db, invoice, client, initialValues.client)
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
  db: Db,
  invoice: InvoiceRow,
  client: ClientRow,
  snapshot: InvoiceFormValues['client'],
): Promise<LinkedCustomer | null> {
  const { n: count } = await db
    .selectFrom('invoices')
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .where('client_id', '=', client.id)
    .where('id', '!=', invoice.id)
    .executeTakeFirstOrThrow()

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
