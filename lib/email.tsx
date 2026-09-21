import { Resend } from 'resend'

import { InvoiceEmail } from '@/emails/invoice-email'
import { VerifyEmail } from '@/emails/verify-email'
import { formatPaise } from '@/lib/money'
import type { InvoiceView } from '@/lib/invoice-view'

/**
 * Sending is optional. The app is fully usable without a Resend key — the user
 * still gets a PDF and a shareable link — so this throws a message that tells
 * them exactly what to configure rather than failing with a null client.
 */
function resend(): Resend {
  const key = process.env.RESEND_API_KEY

  if (!key) {
    throw new Error(
      'Email is not configured. Add RESEND_API_KEY and INVOICE_FROM_EMAIL to your environment.',
    )
  }

  return new Resend(key)
}

function fromAddress(): string {
  const from = process.env.INVOICE_FROM_EMAIL
  if (!from) {
    throw new Error('Set INVOICE_FROM_EMAIL to an address on a domain you have verified in Resend.')
  }
  return from
}

export async function sendInvoiceEmail({
  to,
  view,
  publicUrl,
  pdf,
  filename,
}: {
  to: string
  view: InvoiceView
  publicUrl: string
  pdf: Buffer
  filename: string
}): Promise<string> {
  const supplier = view.business.trade_name || view.business.name
  const total = formatPaise(view.computed.totalMinor, view.currency)

  const { data, error } = await resend().emails.send({
    from: fromAddress(),
    to: [to],
    // Replies should reach the person who raised the invoice, not the sending
    // domain — this is the difference between getting paid and getting ignored.
    replyTo: view.business.email ?? undefined,
    subject: `Invoice ${view.number} from ${supplier} — ${total}`,
    react: <InvoiceEmail view={view} publicUrl={publicUrl} />,
    attachments: [{ filename, content: pdf.toString('base64') }],
    headers: {
      // Stops Gmail collapsing unrelated invoices into one thread, which hides
      // every invoice after the first behind a "show more" fold.
      'X-Entity-Ref-ID': view.number ?? publicUrl,
    },
  })

  if (error) throw new Error(error.message)

  return data?.id ?? ''
}

/**
 * The "verify your email" message. Throws on any failure (including Resend not
 * being configured) — callers decide whether that blocks anything. Signup
 * deliberately does not let it.
 */
export async function sendVerificationEmail({
  to,
  name,
  verifyUrl,
}: {
  to: string
  name?: string | null
  verifyUrl: string
}): Promise<string> {
  const { data, error } = await resend().emails.send({
    from: fromAddress(),
    to: [to],
    subject: 'Verify your email for Invoice AI',
    react: <VerifyEmail name={name} verifyUrl={verifyUrl} />,
  })

  if (error) throw new Error(error.message)

  return data?.id ?? ''
}
