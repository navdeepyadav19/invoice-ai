import { cn } from '@/lib/utils'

/** Active / Archived pill for products and prices, styled like StatusBadge. */
export function CatalogStatus({ active, className }: { active: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        active
          ? 'border-success/25 bg-success/10 text-success'
          : 'border-border bg-muted text-muted-foreground',
        className,
      )}
    >
      {active ? 'Active' : 'Archived'}
    </span>
  )
}
