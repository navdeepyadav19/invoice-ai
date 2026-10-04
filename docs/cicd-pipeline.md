# CI/CD: GitHub → Vercel

A teaching walkthrough, grounded in how *this* project is actually wired up —
run the commands, don't just read them.

## 1. Getting the project onto GitHub

This repo already lives at
[github.com/navdeepyadav19/invoice-ai](https://github.com/navdeepyadav19/invoice-ai).
For a fresh project of your own, the sequence is:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

**Show the students:** the repo page on GitHub — files, commit history, and the
branch dropdown showing `main` as the default.

## 2. Branches — this project has five

```bash
git branch          # branches on your machine
git branch -r        # branches that exist on GitHub
git branch -a        # both, side by side
```

```
  main
  stage-1-mvp
  stage-2-gst-onboarding
  stage-3-hardening
  stage-4-ai-invoice
```

`main` holds the finished product. The four `stage-*` branches are the teaching
sequence — each one branches off the last and adds exactly one lesson's worth
of change (`git log --oneline stage-2-gst-onboarding` shows this literally).
Cutting a branch of your own from any of them is the standard move:

```bash
git checkout -b my-feature stage-1-mvp
```

## 3. Connecting GitHub to Vercel

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **New Project → Import Git Repository** → pick the repo.
3. Vercel reads `package.json` and `pnpm-lock.yaml` and auto-detects: Next.js,
   `pnpm install`, `next build`. Nothing to configure by hand.
4. **Deploy.** First build kicks off immediately.

This project is linked as `horizonpay/invoice-ai`, live at
<https://invoice.horizonpay.co> (custom domain; the original
`invoice-ai-horizonpay.vercel.app` alias still resolves). The same thing done from a
terminal instead of the dashboard — what actually set this project up —
is `vercel link` once, then `vercel deploy --prod`.

## 4. What happens automatically after that

Once a GitHub repo is linked, Vercel installs a webhook and reacts to every
push, no extra setup:

| Push target | What Vercel does |
|---|---|
| Any branch, any commit | Builds it and publishes a **Preview** deployment at a unique URL |
| `main` | Builds it and promotes the result to the **Production** URL |

**Show the students:** push a small commit to `stage-4-ai-invoice` and watch a
preview URL appear in the Vercel dashboard within seconds — *without* touching
`main`. Then show that only a push to `main` ever changes what visitors at the
production URL actually see. That separation — every branch gets its own
throwaway environment, only `main` is "live" — is the entire point of the
pipeline.

## 5. How a build is actually produced

Every deploy, Preview or Production, runs the same three steps:

1. **Install** — `pnpm install`, using `pnpm-lock.yaml` for exact, repeatable
   versions.
2. **Build** — `pnpm build`, which is `next build`. This both typechecks the
   whole project and compiles it; a `tsc` error fails the build here, before
   anything ships.
3. **Deploy** — the compiled output (routes, functions, static assets) is
   published to Vercel's edge network. Serverless routes in this project
   — `/api/ai/*`, `/api/invoices/[id]/pdf`, `/api/public/[token]/pdf` — become
   individual Vercel Functions, not one long-running server.

Build logs are the first place to look when a deploy fails — **Vercel
dashboard → Deployments → (the failed one) → Build Logs.**

## 6. Environment variables

**Project Settings → Environment Variables.** Every value in
[`.env.example`](../.env.example) has a real counterpart there:

| Variable | Required for | Scope |
|---|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Everything — database (pooled for the app, direct for `pnpm db:migrate`) | All environments, injected by the Vercel ↔ Neon integration |
| `NEON_AUTH_BASE_URL` | Sign-in, sessions | All environments, injected by the integration |
| `NEON_AUTH_COOKIE_SECRET` | Session cookie signing | All environments, set by hand (32+ chars) |
| `NEXT_PUBLIC_SITE_URL` | Shareable invoice links | Production, Preview |
| `RESEND_API_KEY`, `INVOICE_FROM_EMAIL` | Emailing invoices | Optional — app works without it |
| `API_KEY_PEPPER`, `CRON_SECRET` | Public API keys, webhook delivery cron | Optional — API requests get `401`, the cron refuses |
| `SANDBOX_API_KEY`, `SANDBOX_API_SECRET` | GST registry prefill (stage 2+) | Optional — falls back to manual entry |
| `OPENAI_API_KEY` | AI invoice creation (stage 4) | Optional — the "Use AI" button just doesn't render |

Two things worth knowing, both because we hit them ourselves building this:

- **`NEXT_PUBLIC_` is the whole rule.** Anything with that prefix is bundled
  into the JavaScript the browser downloads — visible to anyone with
  DevTools open. Anything without it stays server-only. That's *why* the
  only `NEXT_PUBLIC_` value is the site URL: the browser never talks to the
  database, so the connection strings and the Neon Auth settings stay
  server-side with the API secrets. None of them is needed at build time,
  which is why CI builds with no secrets at all.
- **Changing an env var does not touch a deployment that already ran.**
  Vercel bakes env vars in at build time. Update one in the dashboard, then
  **redeploy** — `vercel deploy --prod`, or *Deployments → ⋯ → Redeploy* —
  or the live site keeps using the old value.

## Checklist for the class

- [ ] Repo pushed to GitHub, `main` as the default branch
- [ ] `git branch -a` shows the four stage branches alongside `main`
- [ ] Vercel project linked to the repo, first deploy green
- [ ] Env vars set in Vercel, scoped to Production (and Preview if you want
      branch demos to fully work)
- [ ] Push a branch → watch a Preview URL appear
- [ ] Merge into `main` → watch the Production URL update
