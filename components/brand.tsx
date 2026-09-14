import Link from 'next/link'

import { cn } from '@/lib/utils'

export function Wordmark({ className, href = '/' }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight text-foreground',
        className,
      )}
    >
      <Mark className="size-7" />
      <span>
        Invoice<span className="text-primary">AI</span>
      </span>
    </Link>
  )
}

/**
 * A document with a rule through it — deliberately reads as a sheet of paper
 * rather than a generic app glyph, since the product's output is a document.
 */
export function Mark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="5" y="2" width="22" height="28" rx="3" className="fill-primary" />
      <rect x="9" y="8" width="10" height="2" rx="1" className="fill-primary-foreground/70" />
      <rect x="9" y="13" width="14" height="2" rx="1" className="fill-primary-foreground/40" />
      <rect x="9" y="18" width="14" height="2" rx="1" className="fill-primary-foreground/40" />
      <rect x="9" y="23" width="7" height="2" rx="1" className="fill-primary-foreground" />
    </svg>
  )
}
