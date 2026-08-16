import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { StepBank } from '@/components/onboarding/step-bank'
import { StepIdentity } from '@/components/onboarding/step-identity'
import { Stepper } from '@/components/onboarding/stepper'
import { isSandboxConfigured } from '@/lib/sandbox/client'
import { getPrimaryBusiness, getProfile, requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'Set up your business' }

const COPY = {
  1: {
    title: 'Let’s find your business',
    blurb:
      'Give us your GSTIN and we’ll pull your registered name, address and business type from the GST portal — no typing.',
  },
  2: {
    title: 'How do you get paid?',
    blurb:
      'These three details go at the foot of every invoice so your client can pay without asking. You can skip and add them later.',
  },
} as const

export default async function OnboardingPage() {
  const user = await requireUser()

  // Guests never see the wizard — they fill details inline in the builder.
  if (user.is_anonymous) redirect('/invoices/new')

  const profile = await getProfile()
  if (profile?.onboarding_completed_at) redirect('/dashboard')

  const business = await getPrimaryBusiness()

  // Resume where they left off; the step lives in the database so closing the
  // tab loses nothing.
  const step = (Math.min(2, Math.max(1, profile?.onboarding_step ?? 1)) || 1) as 1 | 2
  const copy = COPY[step]

  return (
    <div className="space-y-8">
      <Stepper current={step} />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy.blurb}</p>
      </div>

      {step === 1 ? (
        <StepIdentity business={business} lookupAvailable={isSandboxConfigured()} />
      ) : (
        <StepBank business={business} />
      )}
    </div>
  )
}
