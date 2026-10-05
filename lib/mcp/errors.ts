import type { CallToolResult } from '@modelcontextprotocol/server'

import { siteUrl } from '@/lib/env'
import { toolError } from '@/lib/mcp/results'
import { isServiceError } from '@/lib/services/errors'

/**
 * Turn a failure into a sentence the model can recover from.
 *
 * REST answers an integrator's code with a status and a `code`; an assistant
 * needs a sentence that says what went wrong *and what to do next*: look the
 * id up, ask the user, wait, or stop. Each ServiceError code maps to one such
 * sentence. Unexpected errors say only that something broke, with the request
 * id — never the underlying message, which can carry internals.
 */
export function toolErrorFromCause(cause: unknown, requestId: string): CallToolResult {
  if (!isServiceError(cause)) {
    console.error('[mcp] unexpected tool error on %s', requestId, cause)
    return toolError(`Something went wrong on our side (request ${requestId}). Tell the user; don't retry in a loop.`)
  }

  const details = cause.details?.map((d) => `${d.path}: ${d.message}`).join('; ')

  switch (cause.code) {
    case 'validation':
      return toolError(`Invalid input. ${cause.message}${details ? ` (${details})` : ''} Fix the arguments and try again.`)
    case 'not_found':
      return toolError(
        `${cause.message} Check the id: use search_customers or list_invoices to find the right one. Ids look like cus_… and in_….`,
      )
    case 'invalid_state':
      return toolError(`${cause.message} Don't retry the same call; tell the user what state the invoice is in.`)
    case 'forbidden':
      return toolError(
        `${cause.message} This connection doesn't have that permission. Ask the user to reconnect Invoice-AI and grant it ` +
          `(${siteUrl()}/settings/ai-assistants). Don't retry.`,
      )
    case 'rate_limited':
      return toolError(`${cause.message} Wait${cause.retryAfter ? ` ${cause.retryAfter} seconds` : ''} before trying again.`)
    case 'conflict':
      return toolError(`${cause.message} The same action is already running; wait a moment, then check with get_invoice.`)
    case 'idempotency_mismatch':
      return toolError('This action was already done with different details. Check the invoice with get_invoice.')
    case 'upstream_failed':
      return toolError(`${cause.message} A service we depend on failed. You may retry once.`)
  }
}
