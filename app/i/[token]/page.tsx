import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Download } from 'lucide-react'

import { InvoiceDocument } from '@/components/invoice/invoice-document'
import { Mark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/app/status-badge'
import { isUuid } from '@/lib/catalog/ids'
import { anonDb } from '@/lib/db'
import { getPublicInvoice, logPublicInvoiceEvent } from '@/lib/db/rpc'
import { isPublicInvoicePayload, viewFromRows } from '@/lib/invoice-load'
import { deriveStatus } from '@/lib/invoice-status'
import { formatPaise } from '@/lib/money'

/**
 * Keep this out of search results. The token is unguessable, but an invoice that
 * a client forwards or pastes somewhere shouldn't end up indexed.
 */
export const metadata: Metadata = {
  title: 'Invoice',
  robots: { index: false, follow: false, nocache: true },
}

export default async function PublicInvoicePage({ params }: PageProps<'/i/[token]'>) {
  const { token } = await params

  // A malformed token, a bad token, a draft and a cancelled invoice are all
  // 404 — the visitor learns nothing about which, which is the point. The
  // shape check keeps a non-uuid from reaching Postgres as a cast error.
  if (!isUuid(token)) notFound()

  const data = await getPublicInvoice(anonDb(), token).catch((cause) => {
    console.error('[public] invoice lookup failed', cause)
    return null
  })
  if (!isPublicInvoicePayload(data)) notFound()

  const view = viewFromRows(data.invoice, data.items)
  const status = deriveStatus(data.invoice)

  void logPublicInvoiceEvent(anonDb(), token, 'viewed').catch(() => {})

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b border-border/70">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3">
            <Mark className="size-7" />
            <div>
              <p className="text-sm font-medium">
                Invoice {view.number} from {view.business.trade_name || view.business.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatPaise(view.computed.totalMinor, view.currency)} due{' '}
                {view.dueDate ? new Date(view.dueDate).toLocaleDateString('en-US', {
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                }) : 'on receipt'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <StatusBadge status={status} />
            <Button
              nativeButton={false}
              render={
                // A plain link, not a fetch-and-blob: it works with right-click
                // "save as", survives being copied, and needs no JavaScript.
                <a href={`/api/public/${token}/pdf?download=1`} />
              }
            >
              <Download className="size-4" />
              Download PDF
            </Button>
          </div>
        </div>
      </header>

      <main className="px-6 py-10">
        <InvoiceDocument view={view} className="rounded-lg" />

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs text-muted-foreground">
          Questions about this invoice? Reply to{' '}
          {view.business.email ? (
            <a
              href={`mailto:${view.business.email}`}
              className="underline underline-offset-4 hover:text-foreground"
            >
              {view.business.email}
            </a>
          ) : (
            view.business.name
          )}
          .
        </p>
      </main>
    </div>
  )
}
