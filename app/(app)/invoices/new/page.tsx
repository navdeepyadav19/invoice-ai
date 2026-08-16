import type { Metadata } from 'next'

import { InvoiceBuilder } from '@/components/invoice/builder'
import { StepBusiness } from '@/components/onboarding/step-business'
import { saveBusinessSettings } from '@/lib/actions/business'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'New invoice' }

export default async function NewInvoicePage() {
  await requireUser()
  const business = await getPrimaryBusiness()

  // Guests skip the onboarding wizard, so this is where they enter their
  // business details — inline, once, and only because the invoice can't be
  // addressed or taxed without them.
  if (!business) {
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">First, who&rsquo;s billing?</h1>
          <p className="text-muted-foreground">
            These details go in the &ldquo;From&rdquo; block of every invoice. Your state decides how
            GST is split, so it&rsquo;s worth getting right. You only do this once.
          </p>
        </div>

        <div className="mt-8">
          <StepBusiness business={null} action={saveBusinessSettings} submitLabel="Continue to invoice" />
        </div>
      </div>
    )
  }

  return <InvoiceBuilder business={business} aiEnabled={Boolean(process.env.OPENAI_API_KEY)} />
}
