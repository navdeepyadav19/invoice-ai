'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import * as invoices from '@/lib/services/invoices'
import { toActionError } from '@/lib/actions/to-action-error'
import { publicInvoiceUrl } from '@/lib/urls'
import type { SendState } from '@/lib/send-state'

/**
 * Finalize an invoice, and optionally email it.
 *
 * What used to happen inline here — claim a number, save it, write an event,
 * render a PDF, send mail — is now invoices.finalize() and invoices.send(). The
 * important change is not that it's shorter: it's that the claim-and-save is a
 * single locked transaction inside issue_invoice(), so two clicks (or two API
 * retries) can no longer burn two numbers.
 */
export async function sendInvoiceAction(
  invoiceId: string,
  options: { email?: boolean } = {},
): Promise<SendState> {
  await requireUser()

  try {
    const ctx = await contextFromSession()

    if (options.email) {
      const result = await invoices.send(ctx, invoiceId)
      revalidateInvoice(invoiceId)
      return {
        publicUrl: result.publicUrl,
        invoiceNumber: result.invoiceNumber,
        emailed: result.emailed,
      }
    }

    const { invoiceNumber } = await invoices.finalize(ctx, invoiceId)
    const { invoice } = await invoices.get(ctx, invoiceId)

    revalidateInvoice(invoiceId)

    return { publicUrl: publicInvoiceUrl(invoice.public_token), invoiceNumber, emailed: false }
  } catch (cause) {
    // An email failure still leaves the invoice issued — the number is spent
    // and unwinding it would break the consecutive series. The service throws
    // upstream_failed with a message that says so, and the UI shows it.
    return toActionError(cause)
  }
}

/** Mark an open invoice as paid. */
export async function payAction(invoiceId: string): Promise<SendState> {
  await requireUser()

  try {
    await invoices.pay(await contextFromSession(), invoiceId, {})
  } catch (cause) {
    return toActionError(cause)
  }

  revalidateInvoice(invoiceId)
  return {}
}

/**
 * Void an open invoice.
 */
export async function voidInvoiceAction(invoiceId: string, reason: string): Promise<SendState> {
  await requireUser()

  try {
    await invoices.voidInvoice(await contextFromSession(), invoiceId, { reason })
  } catch (cause) {
    return toActionError(cause)
  }

  revalidateInvoice(invoiceId)
  return {}
}

function revalidateInvoice(invoiceId: string): void {
  revalidatePath('/dashboard')
  revalidatePath(`/invoices/${invoiceId}/edit`)
}
