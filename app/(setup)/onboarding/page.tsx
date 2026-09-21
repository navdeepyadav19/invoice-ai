import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { StepBank } from '@/components/onboarding/step-bank'
import { StepBusiness } from '@/components/onboarding/step-business'
import { Stepper } from '@/components/onboarding/stepper'
import { saveBusinessStep } from '@/lib/actions/onboarding'
import { countryFromRequest } from '@/lib/locale/geo'
import { getPrimaryBusiness, getProfile, requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'Set up your business' }

const COPY = {
  1: {
    title: 'Tell us about your business',
    blurb:
      'Pick your country and we pre-select your currency. Add your address and an optional tax ID — that is all an invoice needs from you.',
  },
  2: {
    title: 'How do you get paid?',
    blurb:
      'These details go at the foot of every invoice so your client can pay without asking. You can skip and add them later.',
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

  // Pre-select country (and currency via the form) from the request IP.
  // The user can still change it — this is a default, not a decision.
  const detectedCountry = business?.country_code ?? (await countryFromRequest())

  return (
    <div className="space-y-8">
      <Stepper current={step} />

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1>
        <p className="max-w-2xl text-muted-foreground">{copy.blurb}</p>
      </div>

      {step === 1 ? (
        <StepBusiness business={business} detectedCountry={detectedCountry} action={saveBusinessStep} />
      ) : (
        <StepBank business={business} />
      )}
    </div>
  )
}
