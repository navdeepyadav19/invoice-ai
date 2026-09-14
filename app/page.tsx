import { CheckCircle2, CircleDashed } from 'lucide-react'

/**
 * Placeholder home page for the foundation branch.
 *
 * Stage 1 replaces it with the real landing page at app/(marketing)/page.tsx.
 * It stays static on purpose: the foundation has no auth or data yet, so a
 * visible page here proves the build, deploy and env wiring work end to end.
 */
const FOUNDATION = [
  'Next.js app shell, Tailwind and shadcn/ui components',
  'Supabase clients, session proxy and database schema',
  'Shared helpers: money (integer paise) and India GST reference data',
  'CI/CD: lint, typecheck, unit tests and build on every PR; Vercel deploys',
]

const STAGES = [
  { branch: 'stage-1-mvp', title: 'MVP: auth, onboarding, invoice builder, PDF and email' },
  { branch: 'stage-2-gst-onboarding', title: 'GST registry prefill in onboarding' },
  { branch: 'stage-3-hardening', title: 'Bugs found by testing the real flow' },
  { branch: 'stage-4-ai-invoice', title: 'AI-assisted invoice creation' },
]

export default function FoundationPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-6 py-16">
      <header className="space-y-3">
        <p className="text-sm font-medium text-muted-foreground">Invoice-AI</p>
        <h1 className="text-3xl font-semibold tracking-tight">The foundation is live.</h1>
        <p className="text-muted-foreground">
          GST invoicing for Indian merchants, built one pull request at a time. This page is
          everything <code className="font-mono text-sm">main</code> holds before any feature
          is merged.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          In main today
        </h2>
        <ul className="space-y-2">
          {FOUNDATION.map((item) => (
            <li key={item} className="flex gap-3">
              <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Coming in pull requests
        </h2>
        <ol className="space-y-2">
          {STAGES.map((stage) => (
            <li key={stage.branch} className="flex gap-3">
              <CircleDashed className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span>
                {stage.title}{' '}
                <code className="font-mono text-xs text-muted-foreground">{stage.branch}</code>
              </span>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
