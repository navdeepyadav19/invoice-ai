import { z } from 'zod'

import { formatMinor } from '@/lib/money'
import { listPrices, listProducts, retrieveBusiness } from '@/lib/operations/catalog'
import { listCustomers, retrieveCustomer } from '@/lib/operations/customers'
import { listInvoiceEvents, listInvoices, retrieveInvoice } from '@/lib/operations/invoices'
import { defineTool, type ToolAnnotationSet } from '@/lib/mcp/define-tool'
import { cursor, customerId, invoiceId, limit } from '@/lib/mcp/schemas'

/** Every read tool: safe to call any number of times, touches nothing outside Invoice-AI. */
const READ: ToolAnnotationSet = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }

type Invoice = { id: string; number: string | null; status: string; total: number; currency: string; amount_due: number }

export function describeInvoice(invoice: Invoice): string {
  const label = invoice.number ? `${invoice.number} (${invoice.id})` : `Draft ${invoice.id}`
  return `${label}: ${invoice.status}, total ${formatMinor(invoice.total, invoice.currency)}`
}

export const getBusinessProfile = defineTool({
  name: 'get_business_profile',
  title: 'Get business profile',
  description:
    "The user's own business: name, address, tax id and default currency. Call this first when you need the currency or the seller's details.",
  input: z.object({}),
  annotations: READ,
  scope: 'business:read',
  async run(ctx) {
    const body = await retrieveBusiness(ctx)
    const { trade_name, legal_name } = body.data as { trade_name?: string | null; legal_name?: string | null }
    return { summary: `Business: ${trade_name || legal_name || 'unnamed'}`, body }
  },
})

export const searchCustomers = defineTool({
  name: 'search_customers',
  title: 'Search customers',
  description:
    'Find customers by name (case-insensitive, partial match). Use this before creating a customer or an invoice, so you reuse the right existing customer. If several match, ask the user which one.',
  input: z.object({
    query: z.string().optional().describe('Part of the name, e.g. "acme". Omit to list recent customers.'),
    limit,
    cursor,
    include_archived: z.boolean().optional().describe('Also include archived customers.'),
  }),
  annotations: READ,
  scope: 'clients:read',
  async run(ctx, args) {
    const body = await listCustomers(ctx, {
      query: args.query,
      limit: args.limit ?? 10,
      cursor: args.cursor,
      include_deleted: args.include_archived,
    })
    const names = body.data.map((c) => `${c.name} (${c.id})`).join(', ')
    return { summary: body.data.length ? `${body.data.length} customer(s): ${names}` : 'No matching customers.', body }
  },
})

export const getCustomer = defineTool({
  name: 'get_customer',
  title: 'Get a customer',
  description: 'One customer, with email and address.',
  input: z.object({ customer_id: customerId }),
  annotations: READ,
  scope: 'clients:read',
  async run(ctx, args) {
    const body = await retrieveCustomer(ctx, args.customer_id)
    return { summary: `Customer ${body.data.name} (${body.data.id})`, body }
  },
})

export const listProductsTool = defineTool({
  name: 'list_products',
  title: 'List products',
  description: "The user's saved catalog of products. Use list_prices for what they cost.",
  input: z.object({
    query: z.string().optional().describe('Part of the product name.'),
    active: z.boolean().optional().describe('Only active (true) or archived (false) products.'),
    limit,
    cursor,
  }),
  annotations: READ,
  scope: 'products:read',
  async run(ctx, args) {
    const body = await listProducts(ctx, { query: args.query, active: args.active, limit: args.limit ?? 10, cursor: args.cursor })
    return { summary: `${body.data.length} product(s).`, body }
  },
})

export const listPricesTool = defineTool({
  name: 'list_prices',
  title: 'List prices',
  description:
    'Saved prices for catalog products. An invoice line can use a price id (price_…) instead of typing a description and amount.',
  input: z.object({
    product: z.string().optional().describe('Only prices of this product (prod_…).'),
    active: z.boolean().optional().describe('Defaults to active prices only.'),
    currency: z.string().length(3).optional(),
    limit,
    cursor,
  }),
  annotations: READ,
  scope: 'products:read',
  async run(ctx, args) {
    const body = await listPrices(ctx, {
      product: args.product,
      active: args.active ?? true,
      currency: args.currency,
      limit: args.limit ?? 10,
      cursor: args.cursor,
    })
    return { summary: `${body.data.length} price(s).`, body }
  },
})

export const listInvoicesTool = defineTool({
  name: 'list_invoices',
  title: 'List invoices',
  description:
    'Invoices, newest first, without their lines. Filter by status (overdue = open and past its due date) or customer. Use get_invoice for one invoice in full.',
  input: z.object({
    status: z.enum(['draft', 'open', 'paid', 'overdue', 'void']).optional(),
    customer: z.string().optional().describe('Only this customer (cus_…).'),
    from: z.string().optional().describe('Issued on or after this date, YYYY-MM-DD.'),
    to: z.string().optional().describe('Issued on or before this date, YYYY-MM-DD.'),
    limit,
    cursor,
  }),
  annotations: READ,
  scope: 'invoices:read',
  async run(ctx, args) {
    const body = await listInvoices(ctx, { ...args, limit: args.limit ?? 10 })
    const invoices = body.data as Invoice[]
    const due = invoices.reduce((sum, i) => sum + i.amount_due, 0)
    const currencies = new Set(invoices.map((i) => i.currency))
    const owed = currencies.size === 1 && due ? `, ${formatMinor(due, invoices[0].currency)} still owed` : ''
    return { summary: `${invoices.length} invoice(s)${owed}.${body.next_cursor ? ' More available (next_cursor).' : ''}`, body }
  },
})

export const getInvoice = defineTool({
  name: 'get_invoice',
  title: 'Get an invoice',
  description: 'One invoice with its lines, totals and status.',
  input: z.object({ invoice_id: invoiceId }),
  annotations: READ,
  scope: 'invoices:read',
  async run(ctx, args) {
    const body = await retrieveInvoice(ctx, args.invoice_id)
    return { summary: describeInvoice(body.data as Invoice), body }
  },
})

export const listInvoiceEventsTool = defineTool({
  name: 'list_invoice_events',
  title: 'Invoice history',
  description: 'What happened to an invoice: created, finalized, emailed, viewed by the customer, paid, voided — newest first.',
  input: z.object({ invoice_id: invoiceId, limit, cursor }),
  annotations: READ,
  scope: 'invoices:read',
  async run(ctx, args) {
    const body = await listInvoiceEvents(ctx, args.invoice_id, { limit: args.limit ?? 20, cursor: args.cursor })
    return { summary: `${body.data.length} event(s).`, body }
  },
})
