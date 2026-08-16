import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
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

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_public_invoice', { p_token: token })

  if (error || !isPublicInvoicePayload(data)) {
    return new NextResponse('Not found', { status: 404 })
  }

  const view = viewFromRows(data.invoice, data.items)
  const pdf = await renderInvoicePdf(view)

  // Fire-and-forget: a failed analytics write must never cost the client their
  // download, so the result is deliberately ignored.
  void supabase.rpc('log_public_invoice_event', { p_token: token, p_type: 'downloaded' })

  const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${pdfFilename(view)}"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
