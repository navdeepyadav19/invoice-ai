import { cn } from '@/lib/utils'

/**
 * Standard page frame for screens inside the app sidebar layout. The sidebar
 * already owns the viewport edges; pages only centre their own content.
 *
 * - `default` (max-w-6xl): lists and tables — dashboard, customers, products
 * - `narrow` (max-w-3xl): single forms and detail editors
 */
export function PageContainer({
  size = 'default',
  className,
  children,
}: {
  size?: 'default' | 'narrow'
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full px-6 py-10',
        size === 'narrow' ? 'max-w-3xl' : 'max-w-6xl',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Page title row: the page's single <h1>, an optional one-line description,
 * and right-aligned actions (buttons) that wrap under the title on narrow
 * screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4', className)}>
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
