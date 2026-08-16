import Link from 'next/link'
import { Sparkles } from 'lucide-react'

/**
 * Guests are working in a real account that just has no email attached. The
 * honest framing is "add an email to keep this", not "you are in a trial" —
 * nothing is lost or converted when they sign up, the same user id carries over.
 */
export function GuestBanner() {
  return (
    <div className="border-b border-primary/15 bg-primary/[0.06]">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-6 py-2.5 text-sm">
        <Sparkles className="size-4 shrink-0 text-primary" />
        <span className="text-foreground">
          You&rsquo;re working as a guest — invoices are kept for 30 days.
        </span>
        <Link
          href="/claim"
          className="font-medium text-primary underline underline-offset-4 hover:opacity-80"
        >
          Add an email to keep them
        </Link>
        <span className="text-muted-foreground">— everything you&rsquo;ve made stays put.</span>
      </div>
    </div>
  )
}
