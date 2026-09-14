# Invoice-AI

GST-compliant invoicing for Indian merchants and freelancers, built one pull
request at a time.

## What `main` holds

`main` starts as the **foundation**: the pieces every feature builds on, and
the pipeline that guards every change.

| Area | Files |
|---|---|
| App shell | `app/layout.tsx`, `app/globals.css`, placeholder `app/page.tsx` |
| UI kit | `components/ui/*` (shadcn), `lib/utils.ts` |
| Supabase | `lib/supabase/*`, `proxy.ts`, `lib/database.types.ts`, `supabase/migrations/0001–0002` |
| Shared helpers | `lib/money.ts`, `lib/india.ts`, `lib/urls.ts` (with unit tests) |
| CI/CD | `.github/workflows/*` |

## How features arrive

Each stage is a branch opened as a PR into `main`, merged in order:

| # | Branch | Adds |
|---|---|---|
| 1 | `stage-1-mvp` | Guest mode, auth, onboarding wizard, GST engine, invoice builder, PDF, email |
| 2 | `stage-2-gst-onboarding` | GSTIN lookup that prefills the business from the GST registry |
| 3 | `stage-3-hardening` | Fixes for bugs found by testing the real flow in a browser |
| 4 | `stage-4-ai-invoice` | "Use AI": describe or dictate an invoice and review before it fills the form |

## The pipeline

```
Open PR ──► CI: Lint · Typecheck · Unit tests · Build   (required to merge)
        └─► Vercel: preview deployment + PR comment
Merge   ──► CI again on main
        └─► Vercel: production deployment ──► Smoke test of the live site
```

## Running locally

```bash
cp .env.example .env.local   # fill in Supabase values
pnpm install
pnpm dev
```

Checks CI runs: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
