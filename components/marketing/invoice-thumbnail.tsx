import { cn } from '@/lib/utils'

/**
 * A static mock of the finished document, shown on the landing page.
 *
 * Deliberately hand-built rather than a screenshot: it stays crisp at any size,
 * follows the theme into dark mode, and costs no image bytes. The numbers are a
 * real intra-state example — ₹92,000 taxable at 18% splitting into 9% CGST and
 * 9% SGST — so anyone who knows GST can sanity-check it at a glance.
 */
export function InvoiceThumbnail({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-foreground/[0.06]',
        className,
      )}
    >
      <div className="flex items-start justify-between border-b border-border px-7 py-6">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Tax Invoice
          </p>
          <p className="mt-1.5 text-lg font-semibold tracking-tight">Umbrella Design Studio</p>
          <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
            GSTIN 27AAPFU0939F1ZV
          </p>
        </div>
        <div className="text-right">
          <p className="font-mono text-sm font-medium">INV/26-27/0042</p>
          <p className="mt-1 text-[11px] text-muted-foreground">16 Aug 2026</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 border-b border-border px-7 py-5 text-[11px]">
        <div>
          <p className="font-medium uppercase tracking-[0.12em] text-muted-foreground">Bill to</p>
          <p className="mt-1.5 text-sm font-medium text-foreground">Kadam Retail Pvt Ltd</p>
          <p className="mt-0.5 text-muted-foreground">Pune, Maharashtra</p>
        </div>
        <div>
          <p className="font-medium uppercase tracking-[0.12em] text-muted-foreground">
            Place of supply
          </p>
          <p className="mt-1.5 text-sm font-medium text-foreground">27 — Maharashtra</p>
          <p className="mt-0.5 text-muted-foreground">Intra-state supply</p>
        </div>
      </div>

      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-border text-left text-muted-foreground">
            <th className="px-7 py-2.5 font-medium">Description</th>
            <th className="py-2.5 pr-3 text-right font-medium">GST</th>
            <th className="py-2.5 pr-7 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody className="text-foreground">
          <Row label="Brand identity system" hsn="998912" gst="18%" amount="60,000.00" />
          <Row label="Website design, 8 screens" hsn="998314" gst="18%" amount="32,000.00" />
        </tbody>
      </table>

      <div className="border-t border-border px-7 py-5">
        <dl className="ml-auto w-full max-w-[15rem] space-y-1.5 text-[11px]">
          <Total label="Taxable value" value="92,000.00" />
          <Total label="CGST @ 9%" value="8,280.00" />
          <Total label="SGST @ 9%" value="8,280.00" />
          <div className="!mt-3 flex items-baseline justify-between border-t border-border pt-3">
            <dt className="text-sm font-medium">Total</dt>
            <dd className="font-mono text-base font-semibold tabular-nums">₹1,08,560.00</dd>
          </div>
        </dl>
      </div>
    </div>
  )
}

function Row({
  label,
  hsn,
  gst,
  amount,
}: {
  label: string
  hsn: string
  gst: string
  amount: string
}) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="px-7 py-3">
        <span className="block font-medium">{label}</span>
        <span className="font-mono text-[10px] text-muted-foreground">SAC {hsn}</span>
      </td>
      <td className="py-3 pr-3 text-right tabular-nums text-muted-foreground">{gst}</td>
      <td className="py-3 pr-7 text-right font-mono tabular-nums">{amount}</td>
    </tr>
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
