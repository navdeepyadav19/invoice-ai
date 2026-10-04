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

## 2. Branches

```bash
git branch          # branches on your machine
git branch -r        # branches that exist on GitHub
git branch -a        # both, side by side
```

`main` is the only long-lived branch, and it is what production runs. All work
happens on short-lived branches named for what they do (`feat/…`, `fix/…`,
`docs/…`, `chore/…`), merged through a pull request and then deleted:

```bash
git switch -c feat/my-change main
# … commit …
git push -u origin feat/my-change   # then open a PR against main
```

## 3. Connecting GitHub to Vercel

1. Sign in at [vercel.com](https://vercel.com) with your GitHub account.
2. **New Project → Import Git Repository** → pick the repo.
3. Vercel reads `package.json` and `pnpm-lock.yaml` and auto-detects: Next.js,
   `pnpm install`, `next build`. Nothing to configure by hand.
4. **Deploy.** First build kicks off immediately.

This project is linked as `invoice-ai` in the Vercel team `float`, live at
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

**Show the students:** push a small commit to a feature branch and watch a
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
   published to Vercel's edge network. Server routes in this project
   — `/api/v1/*`, `/api/ai/*`, `/api/auth/*`, `/api/cli/*`,
   `/api/invoices/[id]/pdf`, `/api/public/[token]/pdf`, `/api/cron/webhooks` —
   become Vercel Functions in `sin1` (`vercel.json`), not one long-running
   server.

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
| `RESEND_API_KEY`, `INVOICE_FROM_EMAIL` | Emailing invoices, verification emails | Optional — invoices still issue; the email step reports a failure |
| `API_KEY_PEPPER`, `CRON_SECRET` | Public API keys, webhook delivery cron | Optional — API requests get `401`, the cron refuses |
| `OPENAI_API_KEY` | AI invoice creation | Optional — the "Use AI" button just doesn't render |

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

## 7. GitHub Actions: the checks around Vercel

Vercel builds and deploys; GitHub Actions decides whether a change is good
enough to merge, and checks the live site after a deploy. The files are in
`.github/`:

| File | Runs on | What it does |
|---|---|---|
| `workflows/pull-request.yml` | Every PR against `main` | Calls `ci.yml`. A new push to the PR cancels the outdated run. |
| `workflows/production.yml` | Every push to `main`, or **Run workflow** by hand | Calls `ci.yml` again on the merged result. Runs queue one at a time. |
| `workflows/ci.yml` | Only when called (`workflow_call`) | Five parallel jobs: **Lint** (`pnpm lint`), **Typecheck** (`next typegen`, then `pnpm typecheck`), **Unit tests** (`pnpm test`), **API docs up to date** (`pnpm openapi:gen && pnpm postman:gen`, fails on any diff), **Build** (`pnpm build`) |
| `workflows/post-deploy.yml` | `deployment_status` from Vercel | When a **Production** deployment succeeds, runs `scripts/smoke-test.sh` against `vars.PRODUCTION_URL` (default `https://invoice.horizonpay.co`): `/`, `/login`, `/signup` → 200, an unknown `/i/<token>` → 404 |
| `workflows/sync-cli-docs.yml` | Daily at 04:41 UTC, or by hand | Copies `docs/cli-commands.mdx` from invoice-ai-sdk into `api-docs/cli/commands.mdx` and opens a PR if it changed |
| `actions/setup/action.yml` | Every CI job | pnpm (version from `packageManager`), Node 24 with the pnpm cache, `pnpm install --frozen-lockfile` |
| `dependabot.yml` | Weekly | npm and GitHub Actions update PRs, minor/patch grouped |

How they're locked down, since the repo is public and anyone can open a PR:

- **No secrets anywhere in CI.** Nothing is read at build time, so a PR from a
  fork runs exactly the same checks as one from the owner.
- **Read-only token by default.** Every workflow sets `permissions:
  contents: read`. Only the sync job gets `contents: write` and
  `pull-requests: write`, and only on the upstream repo, never in a fork.
- **Checkouts don't keep the token** (`persist-credentials: false`), so code a
  PR runs can't reuse it.
- **No `pull_request_target`**, which would run fork code with write access.
- **Third-party actions are pinned to a commit SHA** (`pnpm/action-setup`,
  `peter-evans/create-pull-request`); GitHub's own `actions/*` use major tags.
  Dependabot bumps both.
- Every job has a `timeout-minutes`.

Two things worth knowing:

- A PR opened by `sync-cli-docs.yml` uses the built-in `GITHUB_TOKEN`, and
  GitHub doesn't start workflows from events that token creates. Its checks
  won't run until you push to the branch or close and reopen the PR. It also
  needs **Settings → Actions → General → Allow GitHub Actions to create and
  approve pull requests** turned on.
- For the PR checks to actually block a merge, mark them required in
  **Settings → Branches** (branch protection on `main`).

## Checklist for the class

- [ ] Repo pushed to GitHub, `main` as the default branch
- [ ] PR checks (Lint, Typecheck, Unit tests, API docs up to date, Build)
      required on `main`
- [ ] Vercel project linked to the repo, first deploy green
- [ ] Env vars set in Vercel, scoped to Production (and Preview if you want
      branch demos to fully work)
- [ ] Push a branch → watch a Preview URL appear
- [ ] Merge into `main` → watch the Production URL update
