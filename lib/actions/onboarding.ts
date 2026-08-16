'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { createClient } from '@/lib/supabase/server'
import { getPrimaryBusiness, requireUser } from '@/lib/queries'
import { persistBusiness } from '@/lib/actions/business'
import { paymentDetailsSchema } from '@/lib/validators'
import { toFieldErrors, type StepState } from '@/lib/form-state'

/**
 * Onboarding is two steps.
 *
 *   1. Who are you?  — a GSTIN (or PAN) that we resolve against the GST registry
 *   2. How do you get paid? — account name, number, IFSC
 *
 * Anything the registry can supply is never asked for, and anything with a sane
 * default (numbering, terms, notes, logo) lives in settings instead. The goal is
 * that a registered business types fifteen characters and is done.
 */

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
    .update({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 2 })
    .eq('id', user.id)

  redirect('/invoices/new')
}

/** Step 1 — identity, whether it came from the GST registry or was typed. */
export async function saveBusinessStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const result = await persistBusiness(formData)
  if (result.error) return result

  await setStep(2)
  return {}
}

/** Step 2 — bank details, then done. Skippable; they can be added later. */
export async function saveBankStep(_prev: StepState, formData: FormData): Promise<StepState> {
  const business = await getPrimaryBusiness()
  if (!business) return { error: 'Add your business details first.' }

  // formData.get() yields null for an absent field and Zod's .optional()
  // rejects null — see the `field` helper in lib/actions/business.ts.
  const value = (name: string) => {
    const raw = formData.get(name)
    return raw === null ? undefined : String(raw)
  }

  const parsed = paymentDetailsSchema.safeParse({
    account_name: value('account_name'),
    account_number: value('account_number'),
    ifsc: value('ifsc'),
  })

  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  const supabase = await createClient()
  const { error } = await supabase
    .from('businesses')
    .update({
      account_name: parsed.data.account_name ?? null,
      account_number: parsed.data.account_number ?? null,
      ifsc: parsed.data.ifsc || null,
    })
    .eq('id', business.id)

  if (error) return { error: error.message }

  return finishOnboarding()
}

/** "Skip for now" on step 2. */
export async function skipStep(formData: FormData): Promise<void> {
  const from = Number(formData.get('step') ?? 2)

  if (from >= 2) return finishOnboarding()

  await setStep(from + 1)
}

/** Back button. Never goes below step 1. */
export async function goToStep(formData: FormData): Promise<void> {
  const target = Math.min(2, Math.max(1, Number(formData.get('step') ?? 1)))
  await setStep(target)
}
