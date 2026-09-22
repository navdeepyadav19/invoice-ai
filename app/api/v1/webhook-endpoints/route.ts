import { json, readJson, withApi } from '@/lib/api/handler'
import * as webhooks from '@/lib/services/webhooks'

/** GET /api/v1/webhook-endpoints?cursor=&limit= — same paging as every other list. */
export const GET = withApi({ scope: 'webhooks:manage' }, async (ctx, request) => {
  const params = new URL(request.url).searchParams
  const page = await webhooks.list(ctx, {
    cursor: params.get('cursor'),
    limit: params.get('limit') ? Number(params.get('limit')) : undefined,
  })
  return json({ data: page.data.map((row) => webhooks.serializeEndpoint(row)), next_cursor: page.next_cursor })
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
