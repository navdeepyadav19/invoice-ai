import { cn } from '@/lib/utils'

/**
 * Local stand-ins for components/app/page-header.tsx (added on the sidebar
 * branch). Same props and markup, so switching over is an import swap.
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

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description ? <div className="mt-1 text-sm text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
