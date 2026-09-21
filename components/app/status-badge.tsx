import { cn } from '@/lib/utils'
import type { InvoiceStatus } from '@/lib/database.types'

const STYLES: Record<InvoiceStatus, string> = {
  draft: 'border-border bg-muted text-muted-foreground',
  open: 'border-primary/25 bg-primary/10 text-primary',
  paid: 'border-success/25 bg-success/10 text-success',
  overdue: 'border-destructive/25 bg-destructive/10 text-destructive',
  void: 'border-border bg-muted text-muted-foreground line-through',
}

const LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  open: 'Open',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
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
