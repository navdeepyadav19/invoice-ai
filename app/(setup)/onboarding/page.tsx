import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { StepBusiness } from '@/components/onboarding/step-business'
import { StepNumbering } from '@/components/onboarding/step-numbering'
import { StepPayment } from '@/components/onboarding/step-payment'
import { Stepper } from '@/components/onboarding/stepper'
import { getPrimaryBusiness, getProfile, requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'Set up your business' }

const COPY = {
  1: {
    title: 'Tell us about your business',
    blurb:
      'This is the “From” block on every invoice you raise. Your state also decides how GST is split, so it is worth getting right.',
  },
  2: {
    title: 'How do you get paid?',
    blurb:
      'These appear at the bottom of the invoice so your client can pay without asking. Skip anything you would rather not print.',
  },
  3: {
    title: 'Invoice numbering',
    blurb:
      'GST invoices need a continuous series. Set the format once and we will keep it running.',
  },
} as const

export default async function OnboardingPage() {
  const user = await requireUser()

  // Guests never see the wizard — they fill these details inline in the builder.
  if (user.is_anonymous) redirect('/invoices/new')

  const profile = await getProfile()
  if (profile?.onboarding_completed_at) redirect('/dashboard')

  const business = await getPrimaryBusiness()

  // Resume where they left off. The step lives in the database, so closing the
  // tab at step 2 and signing back in tomorrow returns them to step 2.
  const step = (Math.min(3, Math.max(1, profile?.onboarding_step ?? 1)) || 1) as 1 | 2 | 3
  const copy = COPY[step]

  return (
    <div className="space-y-8">
      <Stepper current={step} />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy.blurb}</p>
      </div>

      {step === 1 && <StepBusiness business={business} />}
      {step === 2 && <StepPayment business={business} />}
      {step === 3 && <StepNumbering business={business} />}
    </div>
  )
}
