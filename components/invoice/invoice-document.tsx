import { formatInvoiceDate, formatPartyAddress, type InvoiceView } from '@/lib/invoice-view'
import { formatPaise, formatPaisePlain } from '@/lib/money'
import { stateName } from '@/lib/india'
import { cn } from '@/lib/utils'

/**
 * The invoice, as a document.
 *
 * Rendered identically in the builder's live preview and on the public page the
 * client opens. Everything it needs arrives in the InvoiceView, so it never
 * queries, never branches on "am I in preview", and stays a pure function of its
 * props — which is what makes the preview trustworthy.
 */
export function InvoiceDocument({ view, className }: { view: InvoiceView; className?: string }) {
  const { business, client, computed } = view

  const isTaxInvoice = business.is_gst_registered && computed.treatment !== 'unregistered'
  const showIgst = computed.igstTotalPaise > 0 || computed.treatment === 'inter_state'
  const noTaxCollected = computed.taxTotalPaise === 0

  return (
    <article
      className={cn(
        'mx-auto w-full max-w-3xl bg-card text-card-foreground shadow-sm ring-1 ring-border',
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-6 border-b border-border px-8 py-7">
        <div className="min-w-0">
          {business.logo_url ? (
            // Not next/image: the same markup is printed and shipped to clients,
            // where the optimizer endpoint may not be reachable.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={business.logo_url} alt="" className="mb-3 h-11 w-auto object-contain" />
          ) : null}

          <h1 className="text-lg font-semibold tracking-tight">
            {business.trade_name || business.name}
          </h1>
          {business.trade_name && (
            <p className="text-xs text-muted-foreground">{business.name}</p>
          )}

          <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
            {formatPartyAddress(business).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {business.gstin && (
              <p className="font-mono text-foreground">GSTIN {business.gstin}</p>
            )}
            {business.email && <p>{business.email}</p>}
            {business.phone && <p>{business.phone}</p>}
          </div>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {isTaxInvoice ? 'Tax Invoice' : 'Bill of Supply'}
          </p>
          <p className="mt-1.5 font-mono text-base font-semibold">
            {view.number ?? 'Draft'}
          </p>
          <dl className="mt-3 space-y-1 text-xs">
            <div className="flex justify-end gap-3">
              <dt className="text-muted-foreground">Issued</dt>
              <dd className="tabular-nums">{formatInvoiceDate(view.issueDate)}</dd>
            </div>
            {view.dueDate && (
              <div className="flex justify-end gap-3">
                <dt className="text-muted-foreground">Due</dt>
                <dd className="tabular-nums">{formatInvoiceDate(view.dueDate)}</dd>
              </div>
            )}
          </dl>
        </div>
      </header>

      <section className="grid gap-6 border-b border-border px-8 py-6 sm:grid-cols-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Bill to
          </p>
          <p className="mt-2 font-medium">{client.name || 'Your client'}</p>
          <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            {formatPartyAddress(client).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {client.gstin && <p className="font-mono text-foreground">GSTIN {client.gstin}</p>}
          </div>
        </div>

        <div className="sm:text-right">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Place of supply
          </p>
          <p className="mt-2 font-medium">
            {view.placeOfSupplyStateCode} — {stateName(view.placeOfSupplyStateCode) || 'Not set'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{treatmentLabel(view)}</p>
        </div>
      </section>

      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border text-left text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
            <th className="px-8 py-2.5 font-medium">Description</th>
            <th className="py-2.5 pr-4 text-right font-medium">Qty</th>
            <th className="py-2.5 pr-4 text-right font-medium">Rate</th>
            {isTaxInvoice && <th className="py-2.5 pr-4 text-right font-medium">GST</th>}
            <th className="py-2.5 pr-8 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {computed.lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-8 py-8 text-center text-muted-foreground">
                Add a line item to see it here.
              </td>
            </tr>
          ) : (
            computed.lines.map((line, index) => (
              <tr key={index} className="border-b border-border/60 align-top">
                <td className="px-8 py-3">
                  <p className="font-medium text-foreground">{line.description || 'Untitled item'}</p>
                  <p className="mt-0.5 space-x-2 font-mono text-[10px] text-muted-foreground">
                    {line.hsnSac && <span>HSN/SAC {line.hsnSac}</span>}
                    {line.discountPercent > 0 && <span>−{line.discountPercent}% discount</span>}
                  </p>
                </td>
                <td className="py-3 pr-4 text-right tabular-nums">
                  {line.quantity} {line.unit}
                </td>
                <td className="py-3 pr-4 text-right font-mono tabular-nums">
                  {formatPaisePlain(Math.round(line.rate * 100))}
                </td>
                {isTaxInvoice && (
                  <td className="py-3 pr-4 text-right tabular-nums text-muted-foreground">
                    {line.gstRate}%
                  </td>
                )}
                <td className="py-3 pr-8 text-right font-mono tabular-nums">
                  {formatPaisePlain(line.taxablePaise)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <section className="flex flex-wrap justify-between gap-8 border-t border-border px-8 py-6">
        <div className="min-w-[12rem] flex-1 space-y-4 text-xs">
          {view.notes && (
            <div>
              <p className="font-medium">Notes</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{view.notes}</p>
            </div>
          )}
          {view.terms && (
            <div>
              <p className="font-medium">Terms</p>
              <p className="mt-1 whitespace-pre-line text-muted-foreground">{view.terms}</p>
            </div>
          )}
          <PaymentDetails view={view} />
        </div>

        <dl className="w-full max-w-[16rem] space-y-1.5 text-xs">
          <Total label="Subtotal" value={formatPaisePlain(computed.subtotalPaise)} />
          {computed.discountTotalPaise > 0 && (
            <Total label="Discount" value={`−${formatPaisePlain(computed.discountTotalPaise)}`} />
          )}
          <Total label="Taxable value" value={formatPaisePlain(computed.taxableTotalPaise)} />

          {computed.cgstTotalPaise > 0 && (
            <Total label="CGST" value={formatPaisePlain(computed.cgstTotalPaise)} />
          )}
          {computed.sgstTotalPaise > 0 && (
            <Total label="SGST" value={formatPaisePlain(computed.sgstTotalPaise)} />
          )}
          {showIgst && computed.igstTotalPaise > 0 && (
            <Total label="IGST" value={formatPaisePlain(computed.igstTotalPaise)} />
          )}
          {computed.cessTotalPaise > 0 && (
            <Total label="Cess" value={formatPaisePlain(computed.cessTotalPaise)} />
          )}
          {computed.roundOffPaise !== 0 && (
            <Total
              label="Round off"
              value={`${computed.roundOffPaise > 0 ? '+' : '−'}${formatPaisePlain(Math.abs(computed.roundOffPaise))}`}
            />
          )}

          <div className="!mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <dt className="text-sm font-medium">Total</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">
              {formatPaise(computed.totalPaise, view.currency)}
            </dd>
          </div>

          <p className="pt-1 text-[10px] leading-relaxed text-muted-foreground">
            {computed.amountInWords}
          </p>
        </dl>
      </section>

      {(noTaxCollected || computed.reverseCharge) && (
        <p className="border-t border-border px-8 py-4 text-[10px] leading-relaxed text-muted-foreground">
          {declaration(view)}
        </p>
      )}

      {business.signature_url && (
        <div className="flex justify-end border-t border-border px-8 py-6">
          <div className="text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={business.signature_url} alt="" className="mx-auto h-12 w-auto object-contain" />
            <p className="mt-2 border-t border-border pt-1.5 text-[10px] text-muted-foreground">
              Authorised signatory
            </p>
          </div>
        </div>
      )}
    </article>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  )
}

function PaymentDetails({ view }: { view: InvoiceView }) {
  const payment = view.business.payment
  if (!payment) return null

  const hasBank = payment.bank_name || payment.account_number
  if (!hasBank && !payment.upi_id) return null

  return (
    <div>
      <p className="font-medium">Payment details</p>
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        {payment.account_name && <p>{payment.account_name}</p>}
        {payment.bank_name && <p>{payment.bank_name}</p>}
        {payment.account_number && (
          <p className="font-mono">A/C {payment.account_number}</p>
        )}
        {payment.ifsc && <p className="font-mono">IFSC {payment.ifsc}</p>}
        {payment.upi_id && <p className="font-mono">UPI {payment.upi_id}</p>}
      </div>
    </div>
  )
}

function treatmentLabel(view: InvoiceView): string {
  switch (view.computed.treatment) {
    case 'intra_state':
      return 'Intra-state supply — CGST + SGST'
    case 'inter_state':
      return 'Inter-state supply — IGST'
    case 'export':
      return 'Export — zero rated'
    case 'unregistered':
      return 'Supplier not registered for GST'
  }
}

/**
 * The mandatory declaration when no tax is collected. Which sentence applies
 * depends on WHY it's zero, and getting the wrong one on an invoice is the kind
 * of thing a client's accountant sends back.
 */
function declaration(view: InvoiceView): string {
  if (view.computed.reverseCharge) {
    return 'Tax is payable on reverse charge basis by the recipient under Section 9(3)/9(4) of the CGST Act.'
  }
  if (view.computed.treatment === 'export') {
    return 'Supply meant for export under Letter of Undertaking without payment of integrated tax.'
  }
  if (view.computed.treatment === 'unregistered') {
    return 'The supplier is not registered under GST. This is a Bill of Supply and no tax is charged.'
  }
  return ''
}
