'use server'

import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'

import { getPrimaryBusiness, requireUser, sessionDb } from '@/lib/queries'
import { persistBusiness } from '@/lib/actions/business'
import { paymentDetailsSchema } from '@/lib/validators'
import { toFieldErrors, withValues, type StepState } from '@/lib/form-state'
import { RETURN_TO_COOKIE } from '@/lib/auth/return-to'
import { safeNextPath } from '@/lib/safe-redirect'

/**
 * Onboarding is two steps.
 *
 *   1. Who are you?  — name, country (IP-detected), currency, address
 *   2. How do you get paid? — account name, number, routing code
 *
 * Anything with a sane default (numbering, terms, notes, logo) lives in
 * settings instead. The goal is that a new business types a name and is done.
 */

async function setStep(step: number) {
  const user = await requireUser()
  const db = await sessionDb()
  await db.updateTable('profiles').set({ onboarding_step: step }).where('id', '=', user.id).execute()
  revalidatePath('/onboarding')
}

async function finishOnboarding(): Promise<never> {
  const user = await requireUser()
  const db = await sessionDb()

  await db
    .updateTable('profiles')
    .set({ onboarding_completed_at: new Date().toISOString(), onboarding_step: 2 })
    .where('id', '=', user.id)
    .execute()

  // Back to the flow that sent them here (an assistant's consent screen, the
  // CLI login), if one is waiting — see lib/auth/return-to.ts.
  const cookieStore = await cookies()
  const returnTo = cookieStore.get(RETURN_TO_COOKIE)?.value
  if (returnTo) cookieStore.delete(RETURN_TO_COOKIE)

  redirect(safeNextPath(returnTo, '/invoices/new'))
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
  if (!business) return withValues({ error: 'Add your business details first.' }, formData)

  // formData.get() yields null for an absent field and Zod's .optional()
  // rejects null — see the `field` helper in lib/actions/business.ts.
  const value = (name: string) => {
    const raw = formData.get(name)
    return raw === null ? undefined : String(raw)
  }

  const parsed = paymentDetailsSchema.safeParse({
    account_name: value('account_name'),
    account_number: value('account_number'),
    routing_number: value('routing_number'),
  })

  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  try {
    await (await sessionDb())
      .updateTable('businesses')
      .set({
        account_name: parsed.data.account_name ?? null,
        account_number: parsed.data.account_number ?? null,
        routing_number: parsed.data.routing_number || null,
      })
      .where('id', '=', business.id)
      .execute()
  } catch (error) {
    return saveFailed(error, formData)
  }

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

/**
 * Database errors ("Could not find the 'country_code' column…") mean nothing to
 * the person filling the form, and leak schema details. Log the real one for us,
 * show them something they can act on.
 */
function saveFailed(error: unknown, formData: FormData): StepState {
  console.error('[save failed]', error instanceof Error ? error.message : error)
  // Echo the submission: a failed save must not wipe what they typed.
  return withValues(
    { error: "We couldn't save your details. Please try again in a moment." },
    formData,
  )
}
