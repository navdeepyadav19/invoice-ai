'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/queries'
import { persistBusiness, persistNumbering, persistPayment } from '@/lib/actions/business'
import type { StepState } from '@/lib/form-state'

export type { StepState }

async function setStep(step: number) {
  const user = await requireUser()
  const supabase = await createClient()
  await supabase.from('profiles').update({ onboarding_step: step }).eq('id', user.id)
  revalidatePath('/onboarding')
}

async function finishOnboarding(): Promise<never> {
  const user = await requireUser()
  const supabase = await createClient()

  await supabase
    .from('profiles')
    .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 3 })
    .eq('id', user.id)

  // Straight into the builder rather than a dashboard they have nothing to look
  // at yet — and their details are already filled in, so it's half done.
  redirect('/invoices/new')
}

/**
 * Step 1 — the business itself. The only step that cannot be skipped: without a
 * legal name and a state there's no way to compute tax or address the invoice.
 */
export async function saveBusinessStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const result = await persistBusiness(formData)
  if (result.error) return result

  await setStep(2)
  return {}
}

/** Step 2 — how you get paid. Fully skippable. */
export async function savePaymentStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const result = await persistPayment(formData)
  if (result.error) return result

  await setStep(3)
  return {}
}

/** Step 3 — numbering, then done. */
export async function saveNumberingStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const result = await persistNumbering(formData)
  if (result.error) return result

  return finishOnboarding()
}

/** "Skip for now" on steps 2 and 3 — schema defaults already cover both. */
export async function skipStep(formData: FormData): Promise<void> {
  const from = Number(formData.get('step') ?? 2)

  if (from >= 3) return finishOnboarding()

  await setStep(from + 1)
}

/** Back button. Never goes below step 1. */
export async function goToStep(formData: FormData): Promise<void> {
  const target = Math.min(3, Math.max(1, Number(formData.get('step') ?? 1)))
  await setStep(target)
}
