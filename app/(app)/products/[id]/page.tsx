import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

import { CatalogStatus } from '@/components/products/catalog-status'
import { PageContainer, PageHeader } from '@/components/products/page-chrome'
import { PricesSection, ProductStatusButton } from '@/components/products/prices-section'
import { ProductDetailsForm } from '@/components/products/product-details-form'
import { contextFromSession } from '@/lib/auth/context'
import { isProductId } from '@/lib/catalog/ids'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { isServiceError } from '@/lib/services/errors'
import * as prices from '@/lib/services/prices'
import * as products from '@/lib/services/products'

export const metadata: Metadata = { title: 'Product' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function ProductPage({ params }: PageProps<'/products/[id]'>) {
  await requireUser()
  const { id } = await params
  // A malformed id would reach Postgres as an invalid uuid and 500; it's a 404.
  if (!isProductId(id) && !UUID.test(id)) notFound()
  const ctx = await contextFromSession()

  // RLS hides other owners' rows, so "not yours" and "no such id" are the same 404.
  const product = await products.get(ctx, id).catch((cause) => {
    if (isServiceError(cause) && cause.code === 'not_found') notFound()
    throw cause
  })

  const [page, business] = await Promise.all([
    prices.list(ctx, { product: product.id, limit: 100 }),
    getPrimaryBusiness(),
  ])

  return (
    <PageContainer>
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Products
      </Link>

      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-3">
            {product.name}
            <CatalogStatus active={product.active} />
          </span>
        }
        description={<span className="font-mono text-xs">{product.public_id}</span>}
        actions={<ProductStatusButton productId={product.public_id} active={product.active} />}
      />

      {!product.active ? (
        <p className="mt-6 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          This product is archived: it&rsquo;s hidden from the active list and from new invoices.
          Invoices that already use it are unchanged.
        </p>
      ) : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] lg:items-start">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-5 text-sm font-medium">Details</h2>
          <ProductDetailsForm
            productId={product.public_id}
            name={product.name}
            description={product.description}
          />
        </section>

        <PricesSection
          productId={product.public_id}
          defaultCurrency={business?.currency ?? 'USD'}
          prices={page.data}
        />
      </div>
    </PageContainer>
  )
}
