import { z } from 'zod'

import { credentialId } from '@/lib/api/pipeline'
import { DEFAULT_RULES } from '@/lib/api/rate-limit'
import type { AuthContext } from '@/lib/auth/context'
import { viewFromRows } from '@/lib/invoice-load'
import { formatMinor } from '@/lib/money'
import { finalizeInvoice, payInvoice, retrieveInvoice, sendInvoice, voidInvoice } from '@/lib/operations/invoices'
import { ServiceError } from '@/lib/services/errors'
import * as invoices from '@/lib/services/invoices'
import { signConfirmation, stateHash, verifyConfirmation, type ConfirmableAction } from '@/lib/mcp/confirmation'
import { defineTool, type ToolAnnotationSet, type ToolOutput } from '@/lib/mcp/define-tool'
import { confirmationToken, invoiceId } from '@/lib/mcp/schemas'
import { describeInvoice } from '@/lib/mcp/tools/read'

/**
 * The four one-way actions: finalize (spends a number), send (emails a
 * stranger), mark paid, void. Each one asks before it acts — see
 * lib/mcp/confirmation.ts for why the server enforces this rather than trusting
 * the client to ask.
 */

/** Destructive (can't be undone), idempotent (a confirmed retry replays). */
const ONE_WAY: ToolAnnotationSet = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }

type SerializedInvoice = Parameters<typeof describeInvoice>[0] & Record<string, unknown>

interface Confirmable {
  action: ConfirmableAction
  invoiceRef: string
  token: string | undefined
  /** The action's own arguments, as they will be used. Part of what is confirmed. */
  args: Record<string, unknown>
  /** A sentence if there's nothing to do (already finalized, already paid…). */
  alreadyDone?: (invoice: SerializedInvoice) => string | null
  /** What the user is agreeing to, beyond the invoice itself. */
  preview: (invoice: SerializedInvoice) => { line: string; details?: Record<string, unknown>; warnings?: string[] }
  act: () => Promise<{ data: unknown } & Record<string, unknown>>
  done: (body: Record<string, unknown>) => string
}

async function confirmThenAct(ctx: AuthContext, c: Confirmable): Promise<ToolOutput> {
  const { data } = await retrieveInvoice(ctx, c.invoiceRef)
  const invoice = data as SerializedInvoice

  const nothingToDo = c.alreadyDone?.(invoice)
  if (nothingToDo) return { summary: nothingToDo, body: { data: invoice, nothing_to_do: true } }

  const claims = {
    action: c.action,
    invoiceId: invoice.id,
    stateHash: stateHash(invoice, c.args),
    credential: credentialId(ctx),
    userId: ctx.userId,
  }

  if (!c.token) {
    const { line, details, warnings = [] } = c.preview(invoice)
    const { token, expiresAt } = signConfirmation(claims)
    return {
      summary:
        `Confirmation needed — ${line}${warnings.length ? ` WARNING: ${warnings.join(' ')}` : ''} ` +
        'Nothing has happened yet. Show this to the user and wait for an explicit yes, then call again with this confirmation_token.',
      body: {
        requires_confirmation: true,
        action: c.action,
        preview: { invoice: describeInvoice(invoice), ...details, warnings },
        confirmation_token: token,
        expires_at: expiresAt,
      },
    }
  }

  const check = verifyConfirmation(c.token, claims)
  if (!check.ok) {
    throw new ServiceError(
      'validation',
      check.reason === 'changed'
        ? 'The invoice or the action details changed since the preview, so the confirmation no longer applies.'
        : check.reason === 'expired'
          ? 'The confirmation expired (they last 10 minutes).'
          : 'The confirmation_token is not valid for this action and invoice.',
      [{ path: 'confirmation_token', message: 'Call again without confirmation_token to get a fresh preview, and show it to the user.' }],
    )
  }

  const body = await c.act()
  return { summary: c.done(body), body }
}

/** The customer's name and email on the invoice, as the email would use them. */
async function invoiceRecipient(ctx: AuthContext, ref: string) {
  const { invoice, items } = await invoices.get(ctx, ref)
  const { client } = viewFromRows(invoice, items)
  return { name: client.name, email: client.email ?? null }
}

export const finalizeInvoiceTool = defineTool({
  name: 'finalize_invoice',
  title: 'Finalize an invoice',
  description:
    'Give a draft its permanent invoice number and open it for payment. Cannot be undone (the number is spent). Two steps: call without confirmation_token for a preview, show it to the user, then call again with the token once they agree.',
  input: z.object({ invoice_id: invoiceId, confirmation_token: confirmationToken }),
  annotations: ONE_WAY,
  scope: 'invoices:finalize',
  confirmable: true,
  run: (ctx, args) =>
    confirmThenAct(ctx, {
      action: 'finalize',
      invoiceRef: args.invoice_id,
      token: args.confirmation_token,
      args: {},
      alreadyDone: (inv) => (inv.number ? `${describeInvoice(inv)} — already finalized, nothing to do.` : null),
      preview: (inv) => ({ line: `finalize ${describeInvoice(inv)}. It gets the next invoice number.` }),
      act: () => finalizeInvoice(ctx, args.invoice_id),
      done: (body) => `Finalized ${describeInvoice(body.data as SerializedInvoice)}.`,
    }),
})

export const sendInvoiceTool = defineTool({
  name: 'send_invoice',
  title: 'Email an invoice',
  description:
    "Email the invoice PDF and a link to the customer (finalizing it first if it's a draft). Goes to the customer's email unless `to` is given. Two steps: preview first, then call again with the confirmation_token after the user agrees. Requires the user's own email to be verified.",
  input: z.object({
    invoice_id: invoiceId,
    to: z.email().optional().describe("Send somewhere other than the customer's email on file. Only if the user asks."),
    confirmation_token: confirmationToken,
  }),
  annotations: { ...ONE_WAY, openWorldHint: true },
  scope: 'invoices:send',
  rateLimit: DEFAULT_RULES.send,
  rateLimitBucket: 'send',
  confirmable: true,
  async run(ctx, args) {
    const onFile = await invoiceRecipient(ctx, args.invoice_id)
    const recipient = args.to ?? onFile.email
    if (!recipient) {
      throw new ServiceError('validation', 'This customer has no email address on file.', [
        { path: 'to', message: 'Ask the user for the address, or update the customer.' },
      ])
    }

    return confirmThenAct(ctx, {
      action: 'send',
      invoiceRef: args.invoice_id,
      token: args.confirmation_token,
      args: { to: recipient.toLowerCase() },
      preview: (inv) => {
        const warnings: string[] = []
        if (onFile.email && recipient.toLowerCase() !== onFile.email.toLowerCase()) {
          warnings.push(`${recipient} is NOT the customer's email on file (${onFile.email}). Make sure the user asked for this address.`)
        }
        if (!inv.number) warnings.push('This draft will be finalized and numbered first.')
        return { line: `email ${describeInvoice(inv)} to ${onFile.name} at ${recipient}.`, details: { to: recipient }, warnings }
      },
      act: () => sendInvoice(ctx, args.invoice_id, { to: args.to }),
      done: (body) => `Emailed ${describeInvoice(body.data as SerializedInvoice)} to ${body.emailed_to}.`,
    })
  },
})

export const markInvoicePaid = defineTool({
  name: 'mark_invoice_paid',
  title: 'Mark an invoice paid',
  description:
    'Record that an open invoice was paid outside Invoice-AI (bank transfer, cash). Cannot be undone, and notifies any webhooks. Two steps: preview, then confirm with the token.',
  input: z.object({
    invoice_id: invoiceId,
    paid_on: z.string().optional().describe('YYYY-MM-DD. Defaults to today.'),
    reference: z.string().max(200).optional().describe('A payment reference, e.g. a bank transaction id.'),
    confirmation_token: confirmationToken,
  }),
  annotations: ONE_WAY,
  scope: 'payments:write',
  confirmable: true,
  run: (ctx, args) =>
    confirmThenAct(ctx, {
      action: 'pay',
      invoiceRef: args.invoice_id,
      token: args.confirmation_token,
      args: { paid_on: args.paid_on ?? null, reference: args.reference ?? null },
      alreadyDone: (inv) => (inv.status === 'paid' ? `${describeInvoice(inv)} — already paid, nothing to do.` : null),
      preview: (inv) => ({
        line: `mark ${describeInvoice(inv)} as paid${args.paid_on ? ` on ${args.paid_on}` : ' today'}, ${formatMinor(inv.amount_due, inv.currency)} received.`,
      }),
      act: () => payInvoice(ctx, args.invoice_id, { paid_on: args.paid_on, reference: args.reference }),
      done: (body) => `Marked paid: ${describeInvoice(body.data as SerializedInvoice)}.`,
    }),
})

export const voidInvoiceTool = defineTool({
  name: 'void_invoice',
  title: 'Void an invoice',
  description:
    'Cancel a finalized invoice. It keeps its number (shown as void) and nothing is owed. Use delete_invoice_draft for drafts. Needs a reason. Two steps: preview, then confirm with the token.',
  input: z.object({
    invoice_id: invoiceId,
    reason: z.string().min(1).max(500).describe('Why it is void, e.g. "Duplicate of INV-0041". Shown on the record.'),
    confirmation_token: confirmationToken,
  }),
  annotations: ONE_WAY,
  scope: 'invoices:finalize',
  confirmable: true,
  run: (ctx, args) =>
    confirmThenAct(ctx, {
      action: 'void',
      invoiceRef: args.invoice_id,
      token: args.confirmation_token,
      args: { reason: args.reason },
      alreadyDone: (inv) => (inv.status === 'void' ? `${describeInvoice(inv)} — already void, nothing to do.` : null),
      preview: (inv) => ({ line: `void ${describeInvoice(inv)} because "${args.reason}".` }),
      act: () => voidInvoice(ctx, args.invoice_id, { reason: args.reason }),
      done: (body) => `Voided ${describeInvoice(body.data as SerializedInvoice)}.`,
    }),
})
