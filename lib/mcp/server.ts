import type { McpServer } from '@modelcontextprotocol/server'

import { registerTool, type ToolDefinition } from '@/lib/mcp/define-tool'
import { createCustomer, createInvoiceDraft, deleteInvoiceDraft, updateInvoiceDraft } from '@/lib/mcp/tools/drafts'
import { finalizeInvoiceTool, markInvoicePaid, sendInvoiceTool, voidInvoiceTool } from '@/lib/mcp/tools/lifecycle'
import {
  getBusinessProfile,
  getCustomer,
  getInvoice,
  listInvoiceEventsTool,
  listInvoicesTool,
  listPricesTool,
  listProductsTool,
  searchCustomers,
} from '@/lib/mcp/tools/read'

/**
 * The Invoice-AI MCP server: which tools exist, in the order clients list them.
 *
 * Deliberately missing: anything that manages credentials (API keys, webhook
 * endpoints — an assistant must not be able to redirect events or mint keys),
 * catalog editing, and any bulk operation.
 */
export const TOOLS: ToolDefinition[] = [
  getBusinessProfile,
  searchCustomers,
  getCustomer,
  createCustomer,
  listProductsTool,
  listPricesTool,
  listInvoicesTool,
  getInvoice,
  listInvoiceEventsTool,
  createInvoiceDraft,
  updateInvoiceDraft,
  deleteInvoiceDraft,
  finalizeInvoiceTool,
  sendInvoiceTool,
  markInvoicePaid,
  voidInvoiceTool,
] as ToolDefinition[]

export const SERVER_INFO = { name: 'invoice-ai', version: '1.0.0' }

export function registerTools(server: McpServer): void {
  for (const tool of TOOLS) registerTool(server, tool)
}
