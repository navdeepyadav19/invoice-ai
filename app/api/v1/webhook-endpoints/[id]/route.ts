import { noContent, withApi } from '@/lib/api/handler'
import * as webhooks from '@/lib/services/webhooks'

type Params = { id: string }

/**
 * DELETE /api/v1/webhook-endpoints/{id}
 *
 * Naturally idempotent in intent, but a second call 404s rather than silently
 * succeeding — deleting something that is already gone usually means the caller
 * is working from a stale list, and hiding that helps nobody.
 */
export const DELETE = withApi<Params>({ scope: 'webhooks:manage' }, async (ctx, _request, route) => {
  const { id } = await route.params
  await webhooks.remove(ctx, id)
  return noContent()
})
