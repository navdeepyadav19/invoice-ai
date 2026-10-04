import { NextResponse, type NextRequest } from 'next/server'

import { isUuid } from '@/lib/catalog/ids'
import { anonDb } from '@/lib/db'
import { getPublicInvoice, logPublicInvoiceEvent } from '@/lib/db/rpc'
import { isPublicInvoicePayload, viewFromRows } from '@/lib/invoice-load'
import { pdfFilename, renderInvoicePdf } from '@/lib/pdf'

export const runtime = 'nodejs'

/**
 * The client's copy — no session required.
 *
 * Reads through get_public_invoice, the single SECURITY DEFINER function that is
 * the entire public surface. Drafts and cancelled invoices are excluded inside
 * the function, so an unguessable token is the only thing being trusted.
 */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/public/[token]/pdf'>) {
  const { token } = await params

  // A non-uuid can't be a token; 404 it before Postgres rejects the cast.
  const data = isUuid(token)
    ? await getPublicInvoice(anonDb(), token).catch((cause) => {
        console.error('[public] invoice lookup failed', cause)
        return null
      })
    : null

  if (!isPublicInvoicePayload(data)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const view = viewFromRows(data.invoice, data.items)
  const pdf = await renderInvoicePdf(view)

  // Fire-and-forget: a failed analytics write must never cost the client their
  // download, so the result is deliberately ignored.
  void logPublicInvoiceEvent(anonDb(), token, 'downloaded').catch(() => {})

  const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${pdfFilename(view)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
