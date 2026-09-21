'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import * as invoices from '@/lib/services/invoices'
import { toActionError } from '@/lib/actions/to-action-error'
import type { InvoiceInput } from '@/lib/validators'

export interface SaveInvoiceState {
  error?: string
  fieldErrors?: Record<string, string>
  invoiceId?: string
  savedAt?: string
}

/**
 * Save (or create) a draft.
 *
 * An adapter, not a rule-holder. Three concerns used to be tangled together in
 * this function; only the middle one is the business, and it now lives in
 * lib/services/invoices.ts where the REST API calls the exact same code:
 *
 *   who is asking      requireUser() — redirects to /login, right for a page
 *   what to do         invoices.createDraft / updateDraft
 *   page cache         revalidatePath() — meaningless to an API caller
 *
 * The server still recomputes every total from the line items and ignores
 * whatever the client claimed; that guarantee moved into the service intact.
 */
export async function saveInvoiceDraft(
  input: InvoiceInput & { id?: string },
): Promise<SaveInvoiceState> {
  await requireUser()

  try {
    const ctx = await contextFromSession()
    const { id, ...values } = input

    const result = id
      ? await invoices.updateDraft(ctx, id, values as InvoiceInput)
      : await invoices.createDraft(ctx, values as InvoiceInput)

    revalidatePath('/dashboard')

    return { invoiceId: result.invoice.id, savedAt: new Date().toISOString() }
  } catch (cause) {
    return toActionError(cause)
  }
}

/**
 * Delete a draft.
 *
 * New in the service layer — the UI never had it, but an integration that can
 * create a draft needs a way to throw one away.
 */
export async function deleteDraftAction(invoiceId: string): Promise<{ error?: string }> {
  await requireUser()

  try {
    await invoices.deleteDraft(await contextFromSession(), invoiceId)
  } catch (cause) {
    return toActionError(cause)
  }

  revalidatePath('/dashboard')
  return {}
}
