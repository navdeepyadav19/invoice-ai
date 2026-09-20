import { json, readJson, withApi } from '@/lib/api/handler'
import * as webhooks from '@/lib/services/webhooks'

/** GET /api/v1/webhook-endpoints */
export const GET = withApi({ scope: 'webhooks:manage' }, async (ctx) => {
  const endpoints = await webhooks.list(ctx)
  return json({ data: endpoints.map((row) => webhooks.serializeEndpoint(row)) })
})

/**
 * POST /api/v1/webhook-endpoints  { url, events? }
 *
 * The response carries the signing secret. It is the only time the API returns
 * it — subsequent reads omit it, so it cannot leak from a list call into logs
 * or a screenshot.
 *
 * `url` is checked against private and link-local address ranges before being
 * accepted. A webhook URL is a user-supplied address our server will request
 * from inside our own network, which is an SSRF primitive if left unguarded.
 */
export const POST = withApi(
  { scope: 'webhooks:manage', idempotent: 'optional' },
  async (ctx, request) => {
    const body = (await readJson(request)) as { url?: string; events?: string[] }
    const endpoint = await webhooks.create(ctx, { url: body?.url ?? '', events: body?.events })

    return json({ data: webhooks.serializeEndpoint(endpoint, true) }, { status: 201 })
  },
)
