# Contributing

Bug reports, fixes and small features are welcome. For anything bigger than a
bug fix, open an issue first so we can agree on the shape before you build it.
Security problems go through [SECURITY.md](SECURITY.md), not issues.

## Set up

You need Node.js 24 (what CI and Vercel use), pnpm (the version is pinned in
`package.json` → `packageManager`; `corepack enable` picks it up), and a free
[Neon](https://neon.tech) account.

```bash
git clone https://github.com/<you>/invoice-ai.git
cd invoice-ai
pnpm install
cp .env.example .env.local
```

### A database of your own

The app needs Postgres plus Neon Auth. Use your own Neon project, never
someone else's:

1. Create a Neon project, open **Auth** and enable Neon Auth. Turn Neon
   Auth's own **email verification off** (the app sends its own link) and add
   `http://localhost:3000` to its trusted domains.
2. Create a branch (Neon → **Branches** → `dev`) and work on that, not the
   default branch, so a bad migration costs a branch reset instead of your
   data. The branch gets its own Neon Auth with the same settings and its own
   `NEON_AUTH_BASE_URL`. [docs/neon-overview.md](docs/neon-overview.md)
   explains how this repo uses branches.
3. Fill in `.env.local` from the branch's connection details:
   - `DATABASE_URL`: the **pooled** connection string (host contains `-pooler`)
   - `DATABASE_URL_UNPOOLED`: the direct one
   - `NEON_AUTH_BASE_URL`: from the branch's Auth page
   - `NEON_AUTH_COOKIE_SECRET`: `openssl rand -base64 32`
4. Create the schema:

   ```bash
   pnpm db:migrate --status   # what's pending, changes nothing
   pnpm db:migrate            # applies db/migrations/*.sql in order
   ```

5. `pnpm dev` and sign up at <http://localhost:3000/signup>.

Everything else in `.env.example` is optional and the app runs without it:
`OPENAI_API_KEY` (AI invoice creation), `RESEND_API_KEY` + `INVOICE_FROM_EMAIL`
(sending email), `API_KEY_PEPPER` (the `/api/v1` API — mint a key with
`pnpm api:key <email>`), `CRON_SECRET` (webhook delivery cron).

## Before you open a pull request

Run what CI runs (`.github/workflows/ci.yml`):

```bash
pnpm lint
pnpm exec next typegen && pnpm typecheck   # typegen only matters on a fresh checkout
pnpm test
pnpm build
```

CI builds with no secrets, so `pnpm build` must not need any either.

Depending on what you touched:

- **Database.** Add a new file in `db/migrations/`, numbered after the highest
  one there. Never edit a migration that has been applied: the runner
  checksums every file and refuses. Then run `pnpm db:types` to regenerate
  `lib/db/schema.ts`, and update `lib/database.types.ts` to match;
  `lib/db/schema-drift.test.ts` fails typecheck if the two disagree. New
  tables need RLS policies keyed on `owner_id = app.uid()`.
- **The public API** (`lib/api/`, `app/api/v1/`). Run
  `pnpm openapi:gen && pnpm postman:gen` and commit the regenerated
  `api-docs/openapi.json` and `docs/platform/postman/`. CI fails if they drift.
- **Money or tax.** Amounts are integer minor units. Add cases to
  `lib/tax.test.ts` / `lib/money.test.ts`.
- **Developer docs** live in `api-docs/` (Mintlify). Preview with
  `cd api-docs && npx mint dev`.
- New logic gets unit tests next to it (`lib/**/*.test.ts`).

Fill in the pull request template: what changes, how to verify it, and the
checklist. Vercel builds a preview of every PR; link it if your change is
visible.

Never commit `.env*` files (other than `.env.example`), API keys or webhook
secrets. `.gitignore` covers the usual ones, but check `git status` before
committing.

## Notes

- This is Next.js 16, which differs from older versions in places. Read
  `node_modules/next/dist/docs/` before relying on memory of the APIs.
  `next dev` rewrites `AGENTS.md`; leave its generated block as it is.
- The SDKs and the `invoice-ai` CLI live in
  [invoice-ai-sdk](https://github.com/navdeepyadav19/invoice-ai-sdk). Changes
  to them go there.

By contributing you agree that your work is released under the
[MIT License](LICENSE).
