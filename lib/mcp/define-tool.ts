import { createHash } from 'node:crypto'

import type { CallToolResult, McpServer, ServerContext } from '@modelcontextprotocol/server'
import type { z } from 'zod'

import { clientIp, runOperation, type OperationCall } from '@/lib/api/pipeline'
import type { RateLimitRule } from '@/lib/api/rate-limit'
import type { AuthContext } from '@/lib/auth/context'
import type { Scope } from '@/lib/auth/scopes'
import { stableJson } from '@/lib/mcp/confirmation'
import { contextFromAuthInfo } from '@/lib/mcp/context'
import { toolErrorFromCause } from '@/lib/mcp/errors'
import { toolError, toolResult } from '@/lib/mcp/results'

/**
 * One MCP tool: what the model sees, which permission it needs, and the
 * operation it runs.
 *
 * Every tool runs through the same pipeline as a REST request (rate limit,
 * scope, idempotency, audit — lib/api/pipeline.ts), with method `MCP` and
 * route `mcp/<tool>` in the audit log. So an assistant holding a grant can do
 * exactly what an API key with the same scopes can, no more.
 */

export interface ToolOutput {
  /** One line a person would say: "Draft in_… for Acme, total $1,500.00." */
  summary: string
  /** The REST response body for the same operation. */
  body: Record<string, unknown>
}

/**
 * MCP annotations tell clients how careful to be. All four are set on every
 * tool, because the spec's defaults are the cautious ones (destructive, not
 * idempotent, open-world) and a read tool shouldn't look dangerous.
 */
export interface ToolAnnotationSet {
  readOnlyHint: boolean
  destructiveHint: boolean
  idempotentHint: boolean
  openWorldHint: boolean
}

export interface ToolDefinition<Input extends z.ZodObject = z.ZodObject> {
  name: string
  title: string
  /** Read by the model. Says when to use the tool, not just what it does. */
  description: string
  input: Input
  annotations: ToolAnnotationSet
  scope: Scope
  rateLimit?: RateLimitRule
  rateLimitBucket?: string
  /**
   * The tool takes a `confirmation_token` (see lib/mcp/confirmation.ts). Its
   * confirmed calls are idempotent per token: a retried confirmation replays
   * the first result instead of acting twice.
   */
  confirmable?: boolean
  run: (ctx: AuthContext, args: z.infer<Input>) => Promise<ToolOutput>
}

export function defineTool<Input extends z.ZodObject>(definition: ToolDefinition<Input>): ToolDefinition<Input> {
  return definition
}

export function registerTool(server: McpServer, tool: ToolDefinition): void {
  server.registerTool(
    tool.name,
    {
      title: tool.title,
      description: tool.description,
      inputSchema: tool.input,
      annotations: { title: tool.title, ...tool.annotations },
    },
    (args: unknown, mcp: ServerContext) => runTool(tool, args as Record<string, unknown>, mcp),
  )
}

export async function runTool(
  tool: ToolDefinition,
  args: Record<string, unknown>,
  mcp: ServerContext,
): Promise<CallToolResult> {
  const ctx = contextFromAuthInfo(mcp.http?.authInfo)
  const request = mcp.http?.req

  const token = typeof args.confirmation_token === 'string' ? args.confirmation_token : null
  const call: OperationCall = {
    method: 'MCP',
    route: `mcp/${tool.name}`,
    startedAt: Date.now(),
    // A confirmed action is keyed on its token; everything else runs as-is.
    idempotencyKey: tool.confirmable && token ? `mcp:${tool.name}:${sha256(token)}` : null,
    body: async () => stableJson(args),
    clientIp: request ? clientIp(request) : null,
  }

  const outcome = await runOperation(
    ctx,
    {
      scope: tool.scope,
      idempotent: tool.confirmable ? 'optional' : 'none',
      rateLimit: tool.rateLimit,
      rateLimitBucket: tool.rateLimitBucket,
    },
    call,
    () => tool.run(ctx, args),
    (output) => ({ status: 200, stored: async () => output }),
  )

  switch (outcome.kind) {
    case 'done':
      return toolResult(outcome.result.summary, outcome.result.body)

    case 'replayed': {
      const first = outcome.body as ToolOutput
      return toolResult(`${first.summary} (Already done earlier with this confirmation; nothing was repeated.)`, first.body)
    }

    case 'rate_limited':
      return toolError(
        `Rate limit reached (${outcome.rule.limit} per ${outcome.rule.windowSeconds}s). Wait ${outcome.limit.retryAfter} seconds before trying again.`,
      )

    case 'idempotency_key_required':
      // Unreachable: tools never require a key, they derive one.
      return toolError('This action needs a confirmation token. Call it again without one to get a preview.')

    case 'failed':
      return toolErrorFromCause(outcome.error, ctx.requestId)
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 32)
}
