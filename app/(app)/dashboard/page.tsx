import type { Metadata } from 'next'
import Link from 'next/link'
import { FilePlus2, FileText } from 'lucide-react'

import { StatusBadge } from '@/components/app/status-badge'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/queries'
import { formatPaise, toPaise } from '@/lib/money'
import { deriveStatus } from '@/lib/invoice-status'
import type { InvoiceRow, InvoiceStatus } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Invoices' }

export default async function DashboardPage() {
  const user = await requireUser()
  const supabase = await createClient()

  const { data: invoices } = await supabase
    .from('invoices')
    .select('*')
    .eq('owner_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100)

  // Overdue is computed, not stored — see lib/invoice-status.ts. Resolving it
  // once here means the badge, the totals and any future filter can't disagree.
  const rows = (invoices ?? []).map((invoice) => ({
    ...invoice,
    displayStatus: deriveStatus(invoice),
  }))

  const outstanding = rows
    .filter((i) => i.displayStatus === 'sent' || i.displayStatus === 'overdue')
    .reduce((sum, i) => sum + toPaise(Number(i.total)), 0)

  const paid = rows
    .filter((i) => i.displayStatus === 'paid')
    .reduce((sum, i) => sum + toPaise(Number(i.total)), 0)

  const overdueCount = rows.filter((i) => i.displayStatus === 'overdue').length

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows.length === 0
              ? 'Nothing here yet.'
              : `${rows.length} invoice${rows.length === 1 ? '' : 's'}`}
          </p>
        </div>

        <Button nativeButton={false} render={<Link href="/invoices/new" />}>
          <FilePlus2 className="size-4" />
          New invoice
        </Button>
      </div>

      {rows.length > 0 && (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <Stat
            label="Outstanding"
            value={formatPaise(outstanding)}
            note={
              overdueCount > 0
                ? `${overdueCount} invoice${overdueCount === 1 ? '' : 's'} past due`
                : undefined
            }
          />
          <Stat label="Paid" value={formatPaise(paid)} />
        </div>
      )}

      <div className="mt-8">
        {rows.length === 0 ? <EmptyState /> : <InvoiceTable invoices={rows} />}
      </div>
    </div>
  )
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="mt-1 text-xs text-destructive">{note}</p>}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <FileText className="size-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-medium tracking-tight">Raise your first invoice</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        Your business details are saved, so this should take about a minute.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link href="/invoices/new" />}>
        <FilePlus2 className="size-4" />
        New invoice
      </Button>
    </div>
  )
}

function InvoiceTable({ invoices }: { invoices: (InvoiceRow & { displayStatus: InvoiceStatus })[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Number</th>
              <th className="px-5 py-3 font-medium">Client</th>
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
                <td className="px-5 py-3">{clientName(invoice)}</td>
                <td className="px-5 py-3 text-muted-foreground">{formatDate(invoice.issue_date)}</td>
                <td className="px-5 py-3">
                  <StatusBadge status={invoice.displayStatus} />
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

/** The snapshot is the source of truth for a sent invoice, so read the name from it. */
function clientName(invoice: InvoiceRow): string {
  const snapshot = invoice.client_snapshot
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const name = (snapshot as Record<string, unknown>).name
    if (typeof name === 'string' && name.trim()) return name
  }
  return '—'
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}
