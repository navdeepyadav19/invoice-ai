import { renderToBuffer } from '@react-pdf/renderer'

import { InvoicePdf } from '@/components/pdf/invoice-pdf'
import type { InvoiceView } from '@/lib/invoice-view'

/**
 * Render an invoice to PDF bytes.
 *
 * Note what this deliberately does NOT do: call Font.reset() between renders.
 * That's a widely-cited workaround for glyph corruption, but in this version it
 * nulls the cached font data without unregistering the family, so the *next*
 * render dies with "Cannot read properties of null (reading 'unitsPerEm')".
 * Registering once per process and leaving the cache alone is correct here, and
 * lib/pdf.test.tsx renders twice in one process to keep it that way — which
 * matters because Fluid Compute reuses warm instances across requests.
 */
export async function renderInvoicePdf(view: InvoiceView): Promise<Buffer> {
  return renderToBuffer(<InvoicePdf view={view} />)
}

/** `INV-26-27-0042.pdf`, or a stable fallback for a draft with no number yet. */
export function pdfFilename(view: InvoiceView): string {
  const base = (view.number ?? `draft-${view.issueDate}`).replace(/[^A-Za-z0-9-]+/g, '-')
  return `${base}.pdf`
}
