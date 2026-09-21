import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronRight, Package, Plus, Search } from 'lucide-react'

import { CatalogStatus } from '@/components/products/catalog-status'
import { PageContainer, PageHeader } from '@/components/products/page-chrome'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { contextFromSession } from '@/lib/auth/context'
import { summarizePrices } from '@/lib/catalog/price-format'
import { requireUser } from '@/lib/queries'
import * as prices from '@/lib/services/prices'
import * as products from '@/lib/services/products'
import { cn } from '@/lib/utils'
import type { PriceRow, ProductRow } from '@/lib/database.types'

export const metadata: Metadata = { title: 'Products' }

const PAGE_SIZE = 20

const STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'archived', label: 'Archived' },
  { value: 'all', label: 'All' },
] as const

type Status = (typeof STATUSES)[number]['value']

function one(value: string | string[] | undefined): string | undefined {
  const v = Array.isArray(value) ? value[0] : value
  return v?.trim() || undefined
}

function href(params: { q?: string; status?: Status; cursor?: string }): string {
  const search = new URLSearchParams()
  if (params.q) search.set('q', params.q)
  if (params.status && params.status !== 'active') search.set('status', params.status)
  if (params.cursor) search.set('cursor', params.cursor)
  const qs = search.toString()
  return qs ? `/products?${qs}` : '/products'
}

export default async function ProductsPage({ searchParams }: PageProps<'/products'>) {
  await requireUser()
  const sp = await searchParams
  const q = one(sp.q)
  const rawStatus = one(sp.status)
  const status: Status = STATUSES.some((s) => s.value === rawStatus) ? (rawStatus as Status) : 'active'
  const cursor = one(sp.cursor)

  const ctx = await contextFromSession()
  const page = await products.list(ctx, {
    query: q,
    active: status === 'all' ? undefined : status === 'active',
    cursor,
    limit: PAGE_SIZE,
  })
  const activePrices = await prices.listForProducts(
    ctx,
    page.data.map((p) => p.id),
    { active: true },
  )

  const pricesByProduct = new Map<string, PriceRow[]>()
  for (const price of activePrices) {
    const list = pricesByProduct.get(price.product_id) ?? []
    list.push(price)
    pricesByProduct.set(price.product_id, list)
  }

  const filtered = Boolean(q) || status !== 'active' || Boolean(cursor)
  const catalogEmpty = page.data.length === 0 && !filtered

  return (
    <PageContainer>
      <PageHeader
        title="Products"
        description="What you sell, and the prices you charge for it. Pick them on invoices instead of retyping."
        actions={
          <Button nativeButton={false} render={<Link href="/products/new" />}>
            <Plus className="size-4" />
            New product
          </Button>
        }
      />

      {catalogEmpty ? (
        <EmptyState />
      ) : (
        <>
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <nav aria-label="Filter by status" className="flex gap-1 rounded-lg bg-muted p-1">
              {STATUSES.map((s) => (
                <Link
                  key={s.value}
                  href={href({ q, status: s.value })}
                  aria-current={status === s.value ? 'page' : undefined}
                  className={cn(
                    'rounded-md px-3 py-1 text-sm transition-colors',
                    status === s.value
                      ? 'bg-background font-medium text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {s.label}
                </Link>
              ))}
            </nav>

            <form action="/products" className="flex w-full items-center gap-2 sm:w-auto">
              {status !== 'active' ? <input type="hidden" name="status" value={status} /> : null}
              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="search"
                  name="q"
                  defaultValue={q}
                  placeholder="Search by name"
                  aria-label="Search products by name"
                  className="pl-8"
                />
              </div>
              <Button type="submit" variant="outline">
                Search
              </Button>
            </form>
          </div>

          <div className="mt-4">
            {page.data.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-12 text-center">
                <p className="text-sm text-muted-foreground">
                  {q
                    ? `No ${status === 'all' ? '' : `${status} `}products match “${q}”.`
                    : status === 'archived'
                      ? 'No archived products.'
                      : 'Nothing on this page.'}
                </p>
                <Button variant="link" nativeButton={false} render={<Link href="/products" />}>
                  Clear filters
                </Button>
              </div>
            ) : (
              <ProductTable rows={page.data} pricesByProduct={pricesByProduct} />
            )}
          </div>

          {cursor || page.next_cursor ? (
            <div className="mt-4 flex items-center justify-between text-sm">
              {cursor ? (
                <Link href={href({ q, status })} className="text-muted-foreground hover:text-foreground">
                  ← First page
                </Link>
              ) : (
                <span />
              )}
              {page.next_cursor ? (
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<Link href={href({ q, status, cursor: page.next_cursor })} />}
                >
                  Next
                  <ChevronRight />
                </Button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </PageContainer>
  )
}

function ProductTable({
  rows,
  pricesByProduct,
}: {
  rows: ProductRow[]
  pricesByProduct: Map<string, PriceRow[]>
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Description</th>
              <th className="px-5 py-3 font-medium">Pricing</th>
              <th className="px-5 py-3 text-right font-medium">Prices</th>
              <th className="px-5 py-3 font-medium">Status</th>
              <th className="px-5 py-3 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => {
              const active = pricesByProduct.get(product.id) ?? []
              return (
                <tr key={product.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-5 py-3">
                    <Link
                      href={`/products/${product.public_id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {product.name}
                    </Link>
                  </td>
                  <td className="max-w-56 truncate px-5 py-3 text-muted-foreground" title={product.description ?? undefined}>
                    {product.description ?? '—'}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs tabular-nums">
                    {active.length ? (
                      summarizePrices(active)
                    ) : (
                      <span className="font-sans text-muted-foreground">No active prices</span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-right tabular-nums">{active.length}</td>
                  <td className="px-5 py-3">
                    <CatalogStatus active={product.active} />
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-muted-foreground">
                    {formatDate(product.created_at)}
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

function EmptyState() {
  return (
    <div className="mt-8 rounded-xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
        <Package className="size-6 text-muted-foreground" />
      </div>
      <h2 className="mt-4 text-lg font-medium tracking-tight">Add your first product</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground">
        Save what you sell once — a retainer, a license, an hourly rate — with its price, then pick it on
        any invoice.
      </p>
      <Button className="mt-6" nativeButton={false} render={<Link href="/products/new" />}>
        <Plus className="size-4" />
        New product
      </Button>
    </div>
  )
}

function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(new Date(iso))
}
