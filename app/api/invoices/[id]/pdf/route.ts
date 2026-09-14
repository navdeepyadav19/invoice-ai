import { NextResponse, type NextRequest } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/queries'
import { viewFromRows } from '@/lib/invoice-load'
import { pdfFilename, renderInvoicePdf } from '@/lib/pdf'
import type { InvoiceRow } from '@/lib/database.types'

// react-pdf needs real Node APIs (fs, streams) to read the font files.
export const runtime = 'nodejs'

/** The owner's copy. RLS scopes the query, so no ownership check is needed here. */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/invoices/[id]/pdf'>) {
  await requireUser()
  const { id } = await params

  const supabase = await createClient()

  const { data: invoice } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', id)
    .maybeSingle<InvoiceRow>()

  if (!invoice) return new NextResponse('Not found', { status: 404 })

  const { data: items } = await supabase
    .from('invoice_items')
    .select('*')
    .eq('invoice_id', id)
    .order('position', { ascending: true })

  const view = viewFromRows(invoice, items ?? [])
  const pdf = await renderInvoicePdf(view)

  // `inline` so clicking the link previews in the browser; the download
  // attribute on the link is what forces a save when that's what was asked for.
  const disposition = request.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${disposition}; filename="${pdfFilename(view)}"`,
      // A draft's PDF changes on every edit, so never let a proxy hold onto it.
      'Cache-Control': 'private, no-store',
    },
  })
}
