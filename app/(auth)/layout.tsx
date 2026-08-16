import { Wordmark } from '@/components/brand'

export default function AuthLayout({ children }: LayoutProps<'/'>) {
  return (
    <div className="relative flex min-h-svh flex-col">
      {/* Faint ledger ruling behind the card — a nod to paper, kept subtle
          enough that it never competes with the form. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.035] [background-image:repeating-linear-gradient(to_bottom,var(--foreground)_0,var(--foreground)_1px,transparent_1px,transparent_28px)]"
      />

      <header className="relative px-6 py-6">
        <Wordmark />
      </header>

      <main className="relative flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-sm">{children}</div>
      </main>
    </div>
  )
}
