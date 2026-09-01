import Link from 'next/link'
import { Download, FileText, Link2, ShieldCheck } from 'lucide-react'

import { GuestCta } from '@/components/marketing/guest-cta'
import { InvoiceThumbnail } from '@/components/marketing/invoice-thumbnail'
import { Wordmark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'

export default async function LandingPage() {
  const user = await getUser()
  const isSignedIn = Boolean(user) && !user?.is_anonymous

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-10 border-b border-border/70 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
          <Wordmark />

          <nav className="flex items-center gap-2">
            {isSignedIn ? (
              <Button size="sm" nativeButton={false} render={<Link href="/dashboard" />}>
                Go to dashboard
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/login" />}>
                  Sign in
                </Button>
                <Button size="sm" nativeButton={false} render={<Link href="/signup" />}>
                  Create account
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid w-full max-w-6xl gap-12 px-6 py-16 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:py-24">
          <div className="space-y-7">
            <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <ShieldCheck className="size-3.5 text-primary" />
              CGST, SGST and IGST worked out for you
            </p>

            <h1 className="text-balance text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
              GST invoices,
              <br />
              done in a minute.
            </h1>

            <p className="max-w-xl text-pretty text-lg text-muted-foreground">
              For merchants and freelancers who&rsquo;d rather bill a client than fight a
              spreadsheet. Fill in the details, we handle the tax split, the numbering and the PDF.
            </p>

            <GuestCta />

            <p className="text-sm text-muted-foreground">
              No card, no signup to start.{' '}
              <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
                Create an account
              </Link>{' '}
              when you want to keep your invoices.
            </p>
          </div>

          <div className="relative">
            <div
              aria-hidden
              className="absolute -inset-6 rounded-3xl bg-gradient-to-br from-primary/12 via-transparent to-transparent blur-2xl"
            />
            <InvoiceThumbnail className="relative" />
          </div>
        </section>

        <section className="border-y border-border/70 bg-card/50">
          <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-14 sm:grid-cols-3">
            <Feature
              icon={<ShieldCheck className="size-5" />}
              title="The right tax split, every time"
              body="Same state as your client? CGST and SGST, halved to the paisa. Different state? IGST. Exporting? Zero-rated. You pick the place of supply; we do the rest."
            />
            <Feature
              icon={<FileText className="size-5" />}
              title="Numbering that survives an audit"
              body="Sequential per financial year, assigned when you send — so abandoned drafts never leave gaps in your series."
            />
            <Feature
              icon={<Link2 className="size-5" />}
              title="A link your client can open"
              body="Every invoice gets a private link and a clean PDF. Email it from here, or paste the link into WhatsApp."
            />
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-6 py-16">
          <div className="rounded-2xl border border-border bg-card px-8 py-12 text-center">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Raise your first invoice now
            </h2>
            <p className="mx-auto mt-3 max-w-lg text-muted-foreground">
              Start as a guest. If you sign up later, everything you&rsquo;ve made comes with you.
            </p>
            <div className="mt-7 flex justify-center">
              <GuestCta compact />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground sm:flex-row">
          <Wordmark className="text-sm" />
          <p className="flex items-center gap-1.5">
            <Download className="size-3.5" />
            Invoices export as PDF, always yours to keep.
          </p>
        </div>
      </footer>
    </div>
  )
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode
  title: string
  body: string
}) {
  return (
    <div className="space-y-2.5">
      <div className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </div>
      <h3 className="font-medium tracking-tight">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  )
}
