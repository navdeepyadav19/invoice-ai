import { withApi } from '@/lib/api/handler'
import * as invoices from '@/lib/services/invoices'

type Params = { id: string }

/**
 * GET /api/v1/invoices/{id}/pdf
 *
 * Returns the PDF itself, not a link. A signed URL would need an expiry policy
 * and a storage bucket; the document is generated from the row on demand, so
 * streaming it back is both simpler and always current.
 *
 * `?download=1` flips Content-Disposition to attachment, matching the existing
 * owner-facing route so integrators and the web UI behave the same.
 */
export const GET = withApi<Params>({ scope: 'invoices:read' }, async (ctx, request, route) => {
  const { id } = await route.params
  const { buffer, filename } = await invoices.pdf(ctx, id)

  const download = new URL(request.url).searchParams.get('download') === '1'
  const disposition = download ? 'attachment' : 'inline'

  return new Response(new Uint8Array(buffer), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `${disposition}; filename="${filename}"`,
      'content-length': String(buffer.byteLength),
      // An issued invoice never changes, but a draft's PDF does on every edit,
      // so this is not safe to cache publicly.
      'cache-control': 'private, no-store',
    },
  })
})
