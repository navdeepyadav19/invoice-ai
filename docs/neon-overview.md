# How the backend works (Neon)

Invoice AI runs on **Next.js on Vercel** with **Neon** as the whole backend: one
Postgres database that holds both the app's tables and its users. This page
explains how a request becomes "a database connection that can only see one
tenant", because that is the one idea everything else depends on.

> Moved from Supabase in October 2026. Supabase's free tier pauses a project
> after 7 days without traffic, which kept taking the public demo offline.
> Neon scales compute to zero instead: the first request after a quiet spell
> takes about half a second longer, and nothing has to be woken up by hand.

## What Neon provides here

| Piece | What it is | Where it shows up |
|---|---|---|
| **Postgres** | The database (project `invoice-ai-db`, region `aws-ap-southeast-1`, Singapore) | `DATABASE_URL`, `db/migrations/` |
| **Neon Auth** | Managed [Better Auth](https://www.better-auth.com/). Users, sessions and Google links live in the `neon_auth` schema of the **same** database | `NEON_AUTH_BASE_URL`, `lib/auth/server.ts` |
| **Branches** | Copy-on-write clones of the database, auth included, created in about a second | Testing migrations before they touch production |

It was provisioned from Vercel (**Storage → Neon**), so Vercel injects the
connection strings into every environment. Vercel functions run in `sin1`
(`vercel.json`), next to the database.

## Tenant isolation without PostgREST

On Supabase, the browser session's JWT went to PostgREST, which switched the
Postgres role and filled in `auth.uid()`. RLS policies such as
`owner_id = auth.uid()` then did the filtering.

Neon gives us plain Postgres, so the app does that switch itself. Every query
runs inside a transaction that starts like this:

```sql
begin;
set local role authenticated;                              -- RLS now applies
select set_config('app.user_id', '<the user''s uuid>', true); -- app.uid() reads this
-- … the actual query …
commit;
```

- **`app.uid()`** (defined in `db/migrations/0000_neon_prelude.sql`) replaces
  `auth.uid()`. Every policy and SECURITY DEFINER function uses it.
- **`SET LOCAL`** and `set_config(…, true)` end at `COMMIT`. That matters because
  `DATABASE_URL` goes through Neon's pooler (PgBouncer in transaction mode):
  the next request to borrow the connection inherits nothing.
- **The switch lives in the driver**, `lib/db/scoped.ts`, not in a helper
  callers have to remember. The login role (`neondb_owner`) has `BYPASSRLS`, so
  a single query that skipped the switch would read every tenant.

### The three ways to reach the database

| Entry point | Runs as | Used for |
|---|---|---|
| `userDb(userId)` from `lib/db` | `authenticated`, `app.uid()` = that user | Everything a signed-in person or an API key does. `AuthContext.db` is one of these. |
| `anonDb()` from `lib/db` | `anon`: no table access at all | The token-taking functions only: public invoice page, API-key lookup, CLI device start/poll, email-link redemption |
| `systemDb()` from `lib/db/system` | The owner, no RLS | The webhook cron, which has to read every tenant's deliveries. An ESLint rule blocks every other importer. |

Services never filter by `owner_id` by hand. They receive an `AuthContext`
whose `db` already sees only one tenant, whether the caller is a browser
session, an API key or the CLI.

### API keys

`Authorization: Bearer inv_live_…` is looked up through `anonDb()` and its
secret is checked against `HMAC(API_KEY_PEPPER, secret)`. On success the
request gets `userDb(owner_id)`, and from there it is identical to a browser
session. (On Supabase the key was exchanged for a 60-second signed JWT; that
signing key could forge any user, and it no longer exists.)

## Auth

- `lib/auth/server.ts`: `getAuth()` returns the Neon Auth server instance, used
  from server actions (`signUp.email`, `signIn.email`, `signIn.social`,
  `requestPasswordReset`, `resetPassword`, `signOut`) and pages (`getSession`).
- `app/api/auth/[...path]`: proxies Neon Auth's endpoints so cookies stay
  on our domain.
- `proxy.ts`: sends signed-out visitors to `/login?next=…`, and finishes
  Google sign-in by trading the `neon_auth_session_verifier` for a session.
- Profiles are created by the app (`ensureProfile` in `lib/queries.ts`), not by
  a trigger, because `neon_auth` is Neon's schema to migrate.
- Email verification is still the app's own: Resend email, then
  `profiles.email_verified_at`. Neon Auth's verification is off so a new
  account can start onboarding immediately.
- Google OAuth uses our own OAuth client in a dedicated GCP project. The
  authorized redirect URI is `{NEON_AUTH_BASE_URL}/callback/google`.
- There is no guest mode: Neon's managed auth has no anonymous users.

## Local development runs on the `dev` branch

> This is how the maintainer's setup works. Contributors use a Neon project of
> their own, set up the same way: see [CONTRIBUTING.md](../CONTRIBUTING.md).
> `<project-id>` and `<dev-endpoint>` below stand for your own values (Neon
> console, or `neon projects list` / `neon neon-auth status --branch=dev`).

`.env.local` points at a Neon branch called `dev`, not at `main`. `main` is production. The branch is a copy-on-write clone, so
`pnpm dev`, test sign-ups and trial migrations never touch real users. Things to
know about it:

- **It has its own Neon Auth.** Each branch gets its own Neon Auth instance with
  a separate `NEON_AUTH_BASE_URL` (`https://<dev-endpoint>.neonauth…`).
  It also gets its own users and sessions, and copies main's OAuth provider,
  SMTP and trusted-domain settings.
- **Its `NEON_AUTH_COOKIE_SECRET` is local-only.** It differs from production's,
  so a cookie minted locally is worthless against the live site.
- **Don't run `vercel env pull .env.local`.** It writes production's values over
  the branch ones. Pull into another file (`vercel env pull .env.vercel`) and
  copy across only what you need.
- **Reset it to production's current state** with
  `neon branches reset dev --parent --project-id=<project-id>`. That
  throws away everything written to the branch.
- **Google sign-in on localhost** needs the branch's callback added as a second
  redirect URI on the GCP client:
  `{NEON_AUTH_BASE_URL of the dev branch}/callback/google`

## Migrations

```bash
pnpm db:migrate --status       # what is applied / pending (on whichever branch .env.local names)
pnpm db:migrate                # apply new files in db/migrations/, in order
pnpm db:types                  # regenerate lib/db/schema.ts from the live schema
```

- Migrations use `DATABASE_URL_UNPOOLED`: the runner holds an advisory lock,
  which a transaction-mode pooler can't.
- Each file is checksummed in `app.schema_migrations`. Editing an applied file
  is an error; fix forward with a new file.
- `lib/database.types.ts` holds the row types the UI imports.
  `lib/db/schema-drift.test.ts` fails typecheck if they and the generated
  schema disagree on columns.

### Test against a branch first

With `.env.local` on `dev`, plain `pnpm db:migrate` already runs there first.
A bad migration costs one branch reset. To apply to production once it's
proven, point the runner at main explicitly:

```bash
DATABASE_URL_UNPOOLED='<main branch direct connection string>' pnpm db:migrate
```

## Environment variables

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | Vercel ↔ Neon integration |
| `NEON_AUTH_BASE_URL` | Vercel ↔ Neon integration |
| `NEON_AUTH_COOKIE_SECRET` | Set by hand per environment, 32+ chars (`openssl rand -base64 32`) |
| `API_KEY_PEPPER`, `CRON_SECRET` | Set by hand (API keys, webhook cron) |
| `RESEND_API_KEY`, `INVOICE_FROM_EMAIL`, `OPENAI_API_KEY`, `NEXT_PUBLIC_SITE_URL` | Set by hand; same as before the move (see `.env.example`) |

None of these is needed at build time. CI builds with no secrets at all.

## What changed from Supabase

| Concern | Supabase | Neon |
|---|---|---|
| Database access | supabase-js → PostgREST over HTTP | `pg` + Kysely, server-side only |
| "Who is this?" in SQL | `auth.uid()` from the JWT | `app.uid()` from a transaction-local setting |
| Users table | `auth.users` | `neon_auth."user"` |
| Profile creation | Trigger on `auth.users` | `ensureProfile()` in the app |
| API-key requests | Minted a 60 s ES256 JWT | Owner id → `userDb()` |
| Webhook cron | Service-role key | Owner connection (`systemDb()`) |
| Guest mode | Anonymous sign-in | Removed |
| Idle behaviour | Project paused after 7 days | Compute scales to zero |
| Migrations | `supabase db push` | `pnpm db:migrate` |
