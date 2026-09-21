import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { NewProductForm } from '@/components/products/new-product-form'
import { PageContainer, PageHeader } from '@/components/products/page-chrome'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'New product' }

export default async function NewProductPage() {
  await requireUser()
  const business = await getPrimaryBusiness()

  return (
    <PageContainer size="narrow">
      <Link
        href="/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Products
      </Link>
      <PageHeader
        title="New product"
        description="Something you sell, and the first price you charge for it."
      />
      <div className="mt-8">
        <NewProductForm defaultCurrency={business?.currency ?? 'USD'} />
      </div>
    </PageContainer>
  )
}
