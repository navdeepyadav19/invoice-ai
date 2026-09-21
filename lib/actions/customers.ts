'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

import { contextFromSession } from '@/lib/auth/context'
import { toClientRecord } from '@/lib/customers'
import { countryName } from '@/lib/locale/countries'
import { requireUser } from '@/lib/queries'
import * as clients from '@/lib/services/clients'
import { fromPostgres, isServiceError } from '@/lib/services/errors'
import { toFieldErrors, withValues, type StepState } from '@/lib/form-state'
import { clientSchema } from '@/lib/validators'
import type { ClientRow } from '@/lib/database.types'

/**
 * Customers (the `clients` table, public ids `cus_…`) from the web UI.
 *
 * Every write goes through the RLS-scoped session client, so tenant isolation
 * is Postgres's job, not ours. Failures come back as StepState with the
 * submission echoed, so a rejected form keeps what was typed.
 */

function field(formData: FormData, name: string): string | undefined {
  const value = formData.get(name)
  return value === null ? undefined : String(value)
}

function parseForm(formData: FormData) {
  return clientSchema.safeParse({
    name: field(formData, 'name'),
    email: field(formData, 'email'),
    phone: field(formData, 'phone'),
    tax_id: field(formData, 'tax_id'),
    address_line1: field(formData, 'address_line1'),
    address_line2: field(formData, 'address_line2'),
    city: field(formData, 'city'),
    region: field(formData, 'region'),
    postal_code: field(formData, 'postal_code'),
    country_code: field(formData, 'country_code'),
  })
}

/**
 * A thrown error as something the form can show.
 *
 * Not `toActionError`: that passes `upstream_failed` messages through, and for
 * a database failure the message is Postgres's own text. Log it; show a
 * sentence.
 */
function failed(cause: unknown, formData: FormData): StepState {
  if (isServiceError(cause)) {
    if (cause.code === 'validation' && cause.details?.length) {
      const fieldErrors: Record<string, string> = {}
      for (const detail of cause.details) {
        if (!fieldErrors[detail.path]) fieldErrors[detail.path] = detail.message
      }
      return withValues({ error: 'Fix the highlighted fields and try again.', fieldErrors }, formData)
    }
    if (cause.code === 'not_found') {
      return withValues({ error: 'This customer no longer exists.' }, formData)
    }
  }

  console.error('[customers] save failed', cause)
  return withValues(
    { error: "We couldn't save this customer. Please try again in a moment." },
    formData,
  )
}

export async function createCustomerAction(_prev: StepState, formData: FormData): Promise<StepState> {
  await requireUser()

  const parsed = parseForm(formData)
  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  let created: ClientRow
  try {
    const ctx = await contextFromSession()
    const code = parsed.data.country_code
    // The legacy `country` name column defaults to a fixed country; keep it in
    // step with the picked code instead.
    created = await clients.create(ctx, {
      ...parsed.data,
      country: code ? countryName(code) : parsed.data.country,
    })
  } catch (cause) {
    return failed(cause, formData)
  }

  revalidatePath('/customers')
  // Outside the try: redirect() works by throwing.
  redirect(`/customers/${created.public_id}`)
}

/** Bind the id: `updateCustomerAction.bind(null, customer.public_id)`. */
export async function updateCustomerAction(
  id: string,
  _prev: StepState,
  formData: FormData,
): Promise<StepState> {
  await requireUser()

  const parsed = parseForm(formData)
  if (!parsed.success) return toFieldErrors(parsed.error, formData)

  try {
    const ctx = await contextFromSession()
    // Resolves cus_… or a uuid, and is the not-found check (RLS hides others').
    const existing = await clients.get(ctx, id)

    // Written as a full record rather than via clients.update(), whose
    // PATCH semantics would ignore a field the user just emptied.
    const { error } = await ctx.supabase
      .from('clients')
      .update(toClientRecord(parsed.data))
      .eq('id', existing.id)

    if (error) throw fromPostgres(error)

    revalidatePath('/customers')
    revalidatePath(`/customers/${existing.public_id}`)
  } catch (cause) {
    return failed(cause, formData)
  }

  return { saved: true }
}

async function setArchived(id: string, archived: boolean): Promise<{ error?: string }> {
  await requireUser()

  try {
    const ctx = await contextFromSession()
    const row = archived ? await clients.archive(ctx, id) : await clients.unarchive(ctx, id)

    revalidatePath('/customers')
    revalidatePath(`/customers/${row.public_id}`)
    return {}
  } catch (cause) {
    if (isServiceError(cause) && cause.code === 'not_found') {
      return { error: 'This customer no longer exists.' }
    }
    console.error('[customers] archive failed', cause)
    return {
      error: archived
        ? "We couldn't archive this customer. Please try again."
        : "We couldn't restore this customer. Please try again.",
    }
  }
}

export async function archiveCustomerAction(id: string): Promise<{ error?: string }> {
  return setArchived(id, true)
}

export async function unarchiveCustomerAction(id: string): Promise<{ error?: string }> {
  return setArchived(id, false)
}
