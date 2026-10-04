# Invoice-AI

Global invoicing for freelancers and small businesses, Stripe-shaped. Pick your
country and currency, create an invoice, get a PDF and a shareable link, and
email it to your client.

## Live

| | |
|---|---|
| **App** | https://invoice.horizonpay.co |
| Vercel project | `invoice-ai` in team `float`. Functions are pinned to `sin1` (Singapore) in `vercel.json` |
| Database | Neon Postgres, project `invoice-ai-db`, region `aws-ap-southeast-1` (Singapore). Created through the Vercel Marketplace integration, so it's managed from Vercel → Storage |
| Auth | Neon Auth (managed Better Auth). Users live in the `neon_auth` schema of the same database |

Deployment Protection is **off**, so the URL is publicly shareable.

Redeploy with `npx vercel deploy --prod`. Schema changes go in a new file under
`db/migrations/` and are applied with `pnpm db:migrate`. See
[docs/neon-overview.md](docs/neon-overview.md) for how the backend fits together.

## Setting up (a fresh instance)

### 1. Create the database

In the Vercel project: **Storage → Create → Neon**. The integration creates a
Neon project and injects `DATABASE_URL` (pooled) and `DATABASE_URL_UNPOOLED`
(direct) into the project's environment variables. Pick a region next to your functions — this
project uses `aws-ap-southeast-1` with functions in `sin1`.

Then, in the Neon console for that project, open **Auth** and enable Neon Auth.
That gives you `NEON_AUTH_BASE_URL` (the integration syncs it to Vercel; if
it's missing, copy it from the Auth page). Turn Neon Auth's own **email verification off**:
the app sends its own verification link through Resend and tracks it in
`profiles.email_verified_at`, and with Neon's on, a password signup wouldn't
get a session.

### 2. Pull the environment

```bash
vercel link
vercel env pull .env.local
```

`NEON_AUTH_COOKIE_SECRET` is not injected by the integration. Generate one
(`openssl rand -base64 32`) and add it to Vercel and `.env.local` yourself.
Everything else is listed in `.env.example`.

### 3. Run the migrations

```bash
pnpm install
pnpm db:migrate            # applies db/migrations/*.sql in order
pnpm db:migrate --status   # applied / pending, changes nothing
```

The runner uses `DATABASE_URL_UNPOOLED`, takes an advisory lock so two runs
can't overlap, and records each file with a checksum in `app.schema_migrations`.
Editing an applied migration is a hard error. Fix forward with a new file.

`0000_neon_prelude.sql` creates the `anon` and `authenticated` roles and
`app.uid()`. Every RLS policy after it depends on them.

### 4. Turn on Google sign-in (optional)

Create an OAuth client in Google Cloud (this project uses GCP project
`invoice-ai-e34a00`) with the redirect URI `{NEON_AUTH_BASE_URL}/callback/google`,
then add its client id and secret under **Neon console → Auth → OAuth providers**.
Add your app's origins (`http://localhost:3000` and the production domain) to
Neon Auth's trusted domains, or the redirect back to `/auth/callback` is refused.

### 5. Run it

```bash
pnpm dev
```

### Database types

Two files describe the schema, on purpose:

- `lib/db/schema.ts` is **generated** from the live database by
  `pnpm db:types` (kysely-codegen). The query layer uses it. Regenerate after
  every migration.
- `lib/database.types.ts` is **hand-written**: the `InvoiceRow`-style types the
  UI imports. `lib/db/schema-drift.test.ts` fails `pnpm typecheck` if a column
  exists in one and not the other.

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` | Production build (typechecks) |
| `pnpm test` | Vitest — the GST engine and validators |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` (includes the schema drift check) |
| `pnpm db:migrate` | Apply new files in `db/migrations/` (`--status` to just list) |
| `pnpm db:types` | Regenerate `lib/db/schema.ts` from the database |
| `pnpm api:key <email>` | Mint an API key for a user from the terminal (uses `DATABASE_URL_UNPOOLED`) |

## How it fits together

```
app/(marketing)   landing page
app/(auth)        login, signup, password reset, email verification
app/(setup)       onboarding wizard
app/(app)         dashboard, invoice builder, settings — gated
app/api/auth      Neon Auth's endpoints, proxied through our origin
proxy.ts          sends signed-out visitors to /login; finishes Google sign-in
lib/tax.ts        the tax engine (pure, unit tested)
lib/money.ts      integer minor-unit arithmetic, amount in words
lib/validators.ts Zod schemas (internal) + Stripe-shaped wire schemas
lib/catalog/      products & prices (prod_… / price_… ids)
lib/db/           the only way into Postgres: userDb(), anonDb(), typed SQL calls
lib/auth/         Neon Auth server instance, API keys, AuthContext, scopes
db/migrations/    schema, RLS, and the SQL functions
```

**The tax engine is the load-bearing part.** `lib/tax.ts` charges a free-form
exclusive rate per line, computes in integer minor units, and is the same code
the browser runs for the live preview and the server runs before persisting.
The server always recomputes and never trusts totals from the client.

**Products & prices work like Stripe.** A product names what you sell; a price
is one way to charge for it (`unit_amount` in minor units, one-off or
recurring). Invoice lines name a `price_…` or carry ad-hoc amounts.

**The API is Stripe-shaped.** `customers`, `products`, `prices`, `invoices`
(`draft → open → paid`, `void`), `invoice-items`, `finalize` / `pay` / `void`
lifecycle, `cus_…` / `in_…` / `ii_…` ids — with this API's envelope
(`{ data }`), Bearer keys, cursor pagination, and problem+json errors.

**Tenant isolation is RLS, not application code.** Every table keys off
`owner_id = app.uid()`. The database is only reachable from the server, and
`lib/db/scoped.ts` wraps every statement in a transaction that switches to the
`authenticated` role and pins the user id, so the policies apply whether the
request came from a browser session or an API key. There is no public REST
endpoint into the database.

**Invoices freeze their parties.** `business_snapshot` and `client_snapshot` are
JSONB copies taken at issue time, so changing your address later doesn't rewrite
invoices you've already sent.

**Overdue is derived, never stored.** `lib/invoice-status.ts` computes it from
the due date at display time, so there's no nightly job to run and no stale
column. An invoice is not overdue *during* its due date, only after it.

## Onboarding

Two steps:

1. **Who are you?** Pick your country — pre-selected from your IP, changeable —
   and the currency follows it. Add your address and an optional tax ID
   (VAT, EIN, whatever your country uses).
2. **How do you get paid?** Account name, number, routing code. Skippable.

Everything else — logo, signature, payment terms, default notes, invoice
numbering — has a sensible default and lives in **Settings → Business** instead.
None of it is worth standing between someone and their first invoice.

## AI invoice creation

Click "Use AI" and a chat panel opens above the form. Type or dictate what
you're billing for — say "Invoice Acme $45,000 for brand design" — the model
parses it, shows a **summary you must confirm** (client, line items, totals,
tax note), and only touches the form once you click "Fill this in."
Set `OPENAI_API_KEY` to enable it; without the key the button doesn't render.

- **Voice** → `MediaRecorder` → `/api/ai/transcribe` → Whisper.
- **Text** → `/api/ai/parse-invoice` → a chat model with a Zod schema.
- **Nothing is saved without confirmation.** The parsed fields only reach the
  form after the user accepts the summary; the normal autosave takes over
  from there.

One thing the model is deliberately not trusted with, in
`lib/ai/normalise.ts`: converting a tax-inclusive amount back to a pre-tax rate
(arithmetic).

## Emailing invoices

Optional — the app works fully without it, you just don't get the "Email it"
button. To enable:

1. Add a domain in Resend and verify its DNS records.
2. Set `RESEND_API_KEY` and `INVOICE_FROM_EMAIL` (an address on that domain).

Until a domain is verified, Resend only delivers to your own address from
`onboarding@resend.dev`.

## Not built yet

- Payment links and marking paid from a webhook
- Recurring billing runs (intervals are stored on prices; nothing auto-bills yet)
- Credit notes, subscriptions with trials/proration
- A catalog picker in the invoice builder (the catalog is API-first today)
