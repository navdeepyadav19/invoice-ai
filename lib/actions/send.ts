'use server'

import { revalidatePath } from 'next/cache'

import { requireUser } from '@/lib/queries'
import { contextFromSession } from '@/lib/auth/context'
import * as invoices from '@/lib/services/invoices'
import { toActionError } from '@/lib/actions/to-action-error'
import { publicInvoiceUrl } from '@/lib/urls'
import type { SendState } from '@/lib/send-state'

/**
 * Issue an invoice, and optionally email it.
 *
 * What used to happen inline here — claim a number, save it, write an event,
 * render a PDF, send mail — is now invoices.issue() and invoices.send(). The
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

    const { invoiceNumber } = await invoices.issue(ctx, invoiceId)
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

/** Mark an issued invoice as paid. */
export async function markPaidAction(invoiceId: string): Promise<SendState> {
  await requireUser()

  try {
    await invoices.markPaid(await contextFromSession(), invoiceId, {})
  } catch (cause) {
    return toActionError(cause)
  }

  revalidateInvoice(invoiceId)
  return {}
}

/**
 * Cancel an issued invoice.
 *
 * New. The `cancelled` status existed in the enum from day one and nothing ever
 * wrote it, so an invoice sent by mistake had no way out.
 */
export async function cancelInvoiceAction(invoiceId: string, reason: string): Promise<SendState> {
  await requireUser()

  try {
    await invoices.cancel(await contextFromSession(), invoiceId, { reason })
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
