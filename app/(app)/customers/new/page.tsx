import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { CustomerForm } from '@/components/customers/customer-form'
import { createCustomerAction } from '@/lib/actions/customers'
import { requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'New customer' }

export default async function NewCustomerPage() {
  await requireUser()

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <Link
        href="/customers"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Customers
      </Link>

      <div className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">New customer</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only the name is required. Everything else lands in the &ldquo;Bill to&rdquo; block of
          their invoices.
        </p>
      </div>

      <div className="mt-8 rounded-xl border border-border bg-card p-6">
        <CustomerForm action={createCustomerAction} submitLabel="Create customer" />
      </div>
    </div>
  )
}
