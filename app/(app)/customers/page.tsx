import type { Metadata } from 'next'
import Link from 'next/link'
import { Search, UserPlus, Users } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { contextFromSession } from '@/lib/auth/context'
import {
  customersHref,
  formatBilled,
  parseCustomerListParams,
  summarizeInvoices,
  type BilledSummary,
} from '@/lib/customers'
import { countryName } from '@/lib/locale/countries'
import { requireUser } from '@/lib/queries'
import * as clients from '@/lib/services/clients'
import type { ClientRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Customers' }

const PAGE_SIZE = 25

export default async function CustomersPage({ searchParams }: PageProps<'/customers'>) {
  await requireUser()
  const params = parseCustomerListParams(await searchParams)

  const ctx = await contextFromSession()

  let rows: ClientRow[] = []
  let nextCursor: string | null = null
  let loadError = false

  try {
    const page = await clients.list(ctx, {
      query: params.q,
      cursor: params.cursor,
      includeArchived: params.archived,
      limit: PAGE_SIZE,
    })
    rows = page.data
    nextCursor = page.next_cursor
  } catch (cause) {
    console.error('[customers] list failed', cause)
    loadError = true
  }

  // One query for the whole page, rolled up in memory. RLS scopes it to this user.
  let summaries = new Map<string, BilledSummary>()
  if (rows.length) {
    const { data: invoices, error } = await ctx.supabase
      .from('invoices')
      .select('client_id, status, total, currency')
      .in(
        'client_id',
        rows.map((r) => r.id),
      )
    if (error) console.error('[customers] invoice summary failed', error.message)
    summaries = summarizeInvoices(invoices ?? [])
  }

  const filtered = Boolean(params.q)
  const isFirstPage = !params.cursor

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            The people and companies you bill.
          </p>
        </div>

        <Button nativeButton={false} render={<Link href="/customers/new" />}>
          <UserPlus className="size-4" />
          New customer
        </Button>
      </div>

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <form action="/customers" method="get" role="search" className="flex w-full max-w-sm gap-2">
          {params.archived && <input type="hidden" name="archived" value="1" />}
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="q"
              type="search"
              defaultValue={params.q}
              placeholder="Search by name"
              aria-label="Search customers by name"
              className="pl-8"
            />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-2 text-sm">
          <Button
            variant={params.archived ? 'secondary' : 'ghost'}
            size="sm"
            nativeButton={false}
            aria-pressed={params.archived}
            render={<Link href={customersHref({ q: params.q, archived: !params.archived })} />}
          >
            {params.archived ? 'Hide archived' : 'Show archived'}
          </Button>
        </div>
      </div>

      <div className="mt-6">
        {loadError ? (
          <p
            role="alert"
            className="rounded-xl border border-destructive/25 bg-destructive/5 px-5 py-4 text-sm text-destructive"
          >
            We couldn&rsquo;t load your customers.{' '}
            <Link href="/customers" className="underline underline-offset-4">
              Try again
            </Link>
            .
          </p>
        ) : rows.length === 0 ? (
          filtered || !isFirstPage ? (
            <NoMatches q={params.q} archived={params.archived} />
          ) : (
            <EmptyState archived={params.archived} />
          )
        ) : (
          <CustomerTable rows={rows} summaries={summaries} />
        )}
      </div>

      {(nextCursor || !isFirstPage) && !loadError && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-end gap-2">
          {!isFirstPage && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<Link href={customersHref({ q: params.q, archived: params.archived })} />}
            >
              First page
            </Button>
          )}
          {nextCursor && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link
                  href={customersHref({ q: params.q, archived: params.archived, cursor: nextCursor })}
                />
              }
            >
              Next page
            </Button>
          )}
        </nav>
      )}
    </div>
  )
}

function CustomerTable({
  rows,
  summaries,
}: {
  rows: ClientRow[]
  summaries: Map<string, BilledSummary>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Email</th>
              <th className="px-5 py-3 font-medium">Country</th>
              <th className="px-5 py-3 font-medium">Tax ID</th>
              <th className="px-5 py-3 text-right font-medium">Invoices</th>
              <th className="px-5 py-3 text-right font-medium">Billed</th>
              <th className="px-5 py-3 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const summary = summaries.get(row.id)
              return (
                <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/customers/${row.public_id}`}
                        className="font-medium underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                      {row.archived_at && <Badge variant="outline">Archived</Badge>}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-muted-foreground">{row.email ?? '—'}</td>
                  <td className="px-5 py-3 text-muted-foreground">
                    {countryName(row.country_code) || '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                    {row.tax_id ?? row.gstin ?? '—'}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{summary?.count ?? 0}</td>
                  <td className="px-5 py-3 text-right font-mono whitespace-nowrap tabular-nums">
                    {summary ? formatBilled(summary.billed) : '—'}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(row.created_at)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState({ archived }: { archived: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <Users className="size-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-medium tracking-tight">
        {archived ? 'No customers yet' : 'Add your first customer'}
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        Save who you bill once, and pick them from a list on every invoice after that.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link href="/customers/new" />}>
        <UserPlus className="size-4" />
        New customer
      </Button>
    </div>
  )
}

function NoMatches({ q, archived }: { q: string; archived: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
      <p className="text-sm text-muted-foreground">
        {q ? (
          <>
            No customers match &ldquo;{q}&rdquo;
            {archived ? '' : ' among active customers'}.
          </>
        ) : (
          'No more customers.'
        )}
      </p>
      <Link
        href={customersHref({ archived })}
        className="mt-3 inline-block text-sm underline underline-offset-4"
      >
        Clear search
      </Link>
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
