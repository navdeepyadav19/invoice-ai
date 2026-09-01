import { cn } from '@/lib/utils'
import type { InvoiceStatus } from '@/lib/database.types'

const STYLES: Record<InvoiceStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  sent: 'border-primary/25 bg-primary/10 text-primary',
  paid: 'border-success/25 bg-success/10 text-success',
  overdue: 'border-destructive/25 bg-destructive/10 text-destructive',
  cancelled: 'border-border bg-muted text-muted-foreground line-through',
}

const LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

export function StatusBadge({ status, className }: { status: InvoiceStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  )
}
