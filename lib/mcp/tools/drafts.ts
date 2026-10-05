import { z } from 'zod'

import { createCustomer as createCustomerOperation } from '@/lib/operations/customers'
import { createInvoice, deleteInvoice, retrieveInvoice, updateInvoice } from '@/lib/operations/invoices'
import { defineTool } from '@/lib/mcp/define-tool'
import { customerFields, invoiceFields, invoiceId } from '@/lib/mcp/schemas'
import { describeInvoice } from '@/lib/mcp/tools/read'

/**
 * Tools that write, but nothing anyone outside the account sees: customers and
 * draft invoices. A draft has no number and sends nothing, so these run without
 * a confirmation step.
 *
 * Creates are deliberately NOT idempotent. Two identical drafts can both be
 * wanted, and a guessed dedupe key would merge them. Instead the instructions
 * tell the model to look before it creates, and never to blindly retry one.
 */

export const createCustomer = defineTool({
  name: 'create_customer',
  title: 'Create a customer',
  description:
    'Add a new customer. Search with search_customers first — only create one when no existing customer matches, and confirm the details with the user.',
  input: z.object(customerFields),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  scope: 'clients:write',
  async run(ctx, args) {
    const body = await createCustomerOperation(ctx, args)
    return { summary: `Created customer ${body.data.name} (${body.data.id}).`, body }
  },
})

export const createInvoiceDraft = defineTool({
  name: 'create_invoice_draft',
  title: 'Create a draft invoice',
  description:
    'Create a draft invoice for an existing customer. Nothing is numbered or sent. Afterwards, show the user the lines and total, then use finalize_invoice or send_invoice if they want it issued.',
  input: z.object({ customer: z.string().min(1).describe('The customer id (cus_…).'), ...invoiceFields }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  scope: 'invoices:write',
  async run(ctx, args) {
    const body = await createInvoice(ctx, args)
    return { summary: `Created ${describeInvoice(body.data as Parameters<typeof describeInvoice>[0])}.`, body }
  },
})

export const updateInvoiceDraft = defineTool({
  name: 'update_invoice_draft',
  title: 'Update a draft invoice',
  description:
    'Change a draft. Only the fields you send change; sending `items` replaces all lines. Finalized invoices cannot be edited (void and re-create instead).',
  input: z.object({
    invoice_id: invoiceId,
    customer: z.string().optional().describe('Move the draft to another customer (cus_…).'),
    ...invoiceFields,
    items: invoiceFields.items.optional(),
  }),
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: 'invoices:write',
  async run(ctx, { invoice_id, ...changes }) {
    const body = await updateInvoice(ctx, invoice_id, changes)
    return { summary: `Updated ${describeInvoice(body.data as Parameters<typeof describeInvoice>[0])}.`, body }
  },
})

export const deleteInvoiceDraft = defineTool({
  name: 'delete_invoice_draft',
  title: 'Delete a draft invoice',
  description: 'Permanently delete a draft. Only drafts can be deleted; a finalized invoice is voided instead (void_invoice).',
  input: z.object({ invoice_id: invoiceId }),
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  scope: 'invoices:write',
  async run(ctx, args) {
    const { data } = await retrieveInvoice(ctx, args.invoice_id)
    await deleteInvoice(ctx, args.invoice_id)
    return { summary: `Deleted draft ${data.id}.`, body: { deleted: true, id: data.id } }
  },
})
