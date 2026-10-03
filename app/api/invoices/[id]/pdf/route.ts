import { NextResponse, type NextRequest } from 'next/server'

import { isUuid } from '@/lib/catalog/ids'
import { sessionDb } from '@/lib/queries'
import { viewFromRows } from '@/lib/invoice-load'
import { pdfFilename, renderInvoicePdf } from '@/lib/pdf'
import type { InvoiceItemRow, InvoiceRow } from '@/lib/database.types'

// react-pdf needs real Node APIs (fs, streams) to read the font files.
export const runtime = 'nodejs'

/** The owner's copy. RLS scopes the query, so no ownership check is needed here. */
export async function GET(request: NextRequest, { params }: RouteContext<'/api/invoices/[id]/pdf'>) {
  // sessionDb() requires a signed-in user (redirecting otherwise).
  const db = await sessionDb()
  const { id } = await params

  // A non-uuid can't be an invoice id; 404 before Postgres rejects the cast.
  if (!isUuid(id)) return new NextResponse('Not found', { status: 404 })

  const invoice = (await db.selectFrom('invoices').selectAll().where('id', '=', id).executeTakeFirst()) as
    | InvoiceRow
    | undefined

  if (!invoice) return new NextResponse('Not found', { status: 404 })

  const items = (await db
    .selectFrom('invoice_items')
    .selectAll()
    .where('invoice_id', '=', id)
    .orderBy('position', 'asc')
    .execute()) as InvoiceItemRow[]

  const view = viewFromRows(invoice, items)
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
