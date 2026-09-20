import type { Metadata } from 'next'

import { StepBusiness } from '@/components/onboarding/step-business'
import { StepNumbering } from '@/components/onboarding/step-numbering'
import { StepPayment } from '@/components/onboarding/step-payment'
import {
  saveBusinessSettings,
  saveNumberingSettings,
  savePaymentSettings,
} from '@/lib/actions/business'
import { getPrimaryBusiness } from '@/lib/queries'

export const metadata: Metadata = { title: 'Business settings' }

/**
 * Settings reuses the exact same forms as onboarding, passing settings actions
 * instead of wizard actions. One definition of "what a business looks like"
 * means a field added here can never drift out of the signup flow.
 */
export default async function BusinessSettingsPage() {
  const business = await getPrimaryBusiness()

  return (
    <div className="max-w-3xl">
      <div>
        <h2 className="text-lg font-medium">Business profile</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          These details appear on every invoice you raise from now on. Invoices you&rsquo;ve already
          finalized keep the details they were finalized with.
        </p>
      </div>

      <div className="mt-8 space-y-12">
        <Section title="Business details" description="Your name, country, currency and address.">
          <StepBusiness business={business} action={saveBusinessSettings} submitLabel="Save changes" />
        </Section>

        <Section title="Payment details" description="Shown at the foot of the invoice.">
          <StepPayment business={business} action={savePaymentSettings} standalone />
        </Section>

        <Section
          title="Invoice numbering"
          description="Changing the next number affects new invoices only."
        >
          <StepNumbering business={business} action={saveNumberingSettings} standalone />
        </Section>
      </div>
    </div>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-5 border-t border-border pt-8 first:border-0 first:pt-0">
      <div>
        <h3 className="text-base font-medium tracking-tight">{title}</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}
