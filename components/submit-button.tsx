'use client'

import { Loader2 } from 'lucide-react'
import { useFormStatus } from 'react-dom'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * A submit button that disables itself while its form is in flight.
 *
 * useFormStatus reads the status of the nearest enclosing <form>, which is why
 * this has to be its own client component rather than a prop on the page — the
 * hook returns pending: false if called from the component that renders the form.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus()

  return (
    <Button type="submit" disabled={pending} className={cn(className)} {...props}>
      {pending && <Loader2 className="size-4 animate-spin" />}
      {pending && pendingLabel ? pendingLabel : children}
    </Button>
  )
}
