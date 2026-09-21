import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FilePlus2, FileText } from 'lucide-react'

import { ArchiveCustomerButton } from '@/components/customers/archive-customer-button'
import { CustomerForm } from '@/components/customers/customer-form'
import { StatusBadge } from '@/components/app/status-badge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { updateCustomerAction } from '@/lib/actions/customers'
import { contextFromSession } from '@/lib/auth/context'
import { isCustomerId } from '@/lib/catalog/ids'
import { formatBilled, formatClientAddress, summarizeInvoices } from '@/lib/customers'
import { deriveStatus } from '@/lib/invoice-status'
import { formatPaise, toPaise } from '@/lib/money'
import { requireUser } from '@/lib/queries'
import * as clients from '@/lib/services/clients'
import { isServiceError } from '@/lib/services/errors'
import type { ClientRow, InvoiceRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Customer' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type InvoiceListRow = Pick<
  InvoiceRow,
  'id' | 'invoice_number' | 'issue_date' | 'due_date' | 'status' | 'total' | 'currency' | 'client_id'
>

export default async function CustomerPage({ params }: PageProps<'/customers/[id]'>) {
  await requireUser()
  const { id } = await params

  // Anything that isn't a cus_… or uuid can't be a customer — 404 without
  // sending Postgres a malformed uuid.
  if (!isCustomerId(id) && !UUID.test(id)) notFound()

  const ctx = await contextFromSession()

  let customer: ClientRow
  try {
    customer = await clients.get(ctx, id)
  } catch (cause) {
    // RLS: someone else's customer is indistinguishable from a missing one.
    if (isServiceError(cause) && cause.code === 'not_found') notFound()
    throw cause
  }

  const { data, error } = await ctx.supabase
    .from('invoices')
    .select('id, invoice_number, issue_date, due_date, status, total, currency, client_id')
    .eq('client_id', customer.id)
    .order('created_at', { ascending: false })
    .limit(50)

  if (error) console.error('[customers] invoice list failed', error.message)
  const invoices = (data ?? []) as InvoiceListRow[]
  const summary = summarizeInvoices(invoices).get(customer.id)

  const address = formatClientAddress({
    ...customer,
    postal_code: customer.postal_code ?? customer.pincode,
  })
  const archived = Boolean(customer.archived_at)

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Customers
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{customer.name}</h1>
            {archived && <Badge variant="outline">Archived</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {[customer.email, address].filter(Boolean).join(' · ') || 'No contact details yet.'}
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">{customer.public_id}</p>
        </div>

        <div className="flex items-center gap-2">
          <ArchiveCustomerButton id={customer.public_id} name={customer.name} archived={archived} />
          {!archived && (
            <Button size="sm" nativeButton={false} render={<Link href="/invoices/new" />}>
              <FilePlus2 className="size-4" />
              New invoice
            </Button>
          )}
        </div>
      </div>

      {archived && (
        <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          This customer is archived: hidden from your customer list and the invoice builder.
          Existing invoices are unaffected.
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Stat label="Invoices" value={String(summary?.count ?? 0)} />
        <Stat label="Billed" value={summary ? formatBilled(summary.billed) : '—'} />
      </div>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Details</h2>
        <div className="mt-4 rounded-xl border border-border bg-card p-6">
          <CustomerForm
            customer={customer}
            action={updateCustomerAction.bind(null, customer.public_id)}
            submitLabel="Save changes"
          />
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-lg font-medium">Invoices</h2>
        <div className="mt-4">
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center">
              <FileText className="mx-auto size-6 text-muted-foreground" />
              <p className="mt-2 text-sm text-muted-foreground">No invoices for this customer yet.</p>
            </div>
          ) : (
            <InvoiceTable invoices={invoices} />
          )}
        </div>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  )
}

function InvoiceTable({ invoices }: { invoices: InvoiceListRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Number</th>
              <th className="px-5 py-3 font-medium">Issued</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {invoices.map((invoice) => (
              <tr key={invoice.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                <td className="px-5 py-3">
                  <Link
                    href={`/invoices/${invoice.id}/edit`}
                    className="font-mono text-xs font-medium underline-offset-4 hover:underline"
                  >
                    {invoice.invoice_number ?? 'Draft'}
                  </Link>
                </td>
                <td className="px-5 py-3 text-muted-foreground">{formatDate(invoice.issue_date)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={deriveStatus(invoice)} />
                </td>
                <td className="px-5 py-3 text-right font-mono tabular-nums">
                  {formatPaise(toPaise(Number(invoice.total)), invoice.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
