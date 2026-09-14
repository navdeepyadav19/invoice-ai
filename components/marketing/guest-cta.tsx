'use client'

import { ArrowRight } from 'lucide-react'
import Link from 'next/link'

import { continueAsGuestAction } from '@/lib/actions/auth'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The guest entry point. Submitting this creates an anonymous Supabase user —
 * a real account in every respect except that it has no email yet — and drops
 * them straight into the builder.
 */
export function GuestCta({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-3', compact && 'justify-center')}>
      <form action={continueAsGuestAction}>
        <SubmitButton size="lg" pendingLabel="Setting things up…">
          Create an invoice
          <ArrowRight className="size-4" />
        </SubmitButton>
      </form>

      {!compact && (
        <Button variant="ghost" size="lg" nativeButton={false} render={<Link href="/signup" />}>
          Or create an account
        </Button>
      )}
    </div>
  )
}
