# Invoice-AI

Global invoicing for freelancers and small businesses, Stripe-shaped. Pick your
country and currency, create an invoice signed in or as a guest, get a PDF and
a shareable link, and email it to your client.

## Live

| | |
|---|---|
| **App** | https://invoice-ai-horizonpay.vercel.app |
| Vercel project | `horizonpay/invoice-ai` |
| Supabase project | `invoice-ai` — ref `pdsoufmhwnxkzxfigaxp`, region `ap-south-1` (Mumbai) |
| Supabase dashboard | https://supabase.com/dashboard/project/pdsoufmhwnxkzxfigaxp |

Deployment Protection is **off**, so the URL is publicly shareable.

Redeploy with `npx vercel deploy --prod`. Schema changes go through
`supabase/migrations/` and `npx supabase db push`; auth settings live in
`supabase/config.toml` and go up with `npx supabase config push`.

## Setting up (a fresh instance)

### 1. Create a Supabase project

<https://supabase.com/dashboard> → New project. Then copy the API settings:

```bash
cp .env.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

### 2. Run the migration

Paste `supabase/migrations/0001_init.sql` into the Supabase SQL editor and run
it, or use the CLI:

```bash
pnpm dlx supabase link --project-ref <your-ref>
pnpm dlx supabase db push
```

### 3. Turn on three auth settings

In **Authentication → Sign In / Providers**:

| Setting | Value | Why |
|---|---|---|
| Anonymous sign-ins | **On** | Guest mode. Without it the "Create an invoice" button fails. |
| Manual linking | **On** | Lets a guest attach an email later and keep the same user id. |
| Confirm email | **On** | Signup sends a confirmation link before the session starts. |

Add `http://localhost:3000/auth/callback` to **URL Configuration → Redirect
URLs**, plus your deployed URL once you have one.

Anonymous sign-in is an unauthenticated user-creation endpoint, so enable the
Turnstile captcha on it before you put this in front of real traffic.

### 4. Regenerate the database types

`lib/database.types.ts` is hand-written to match the migration so the project
compiles before a Supabase project exists. Replace it with the real thing:

```bash
pnpm dlx supabase gen types typescript --project-id <your-ref> > lib/database.types.ts
```

> Row types must be `type` aliases, never `interface`. postgrest-js requires
> rows to satisfy `Record<string, unknown>`, and interfaces have no implicit
> index signature — an interface silently degrades every insert and update to
> `never`. The generator emits aliases; keep it that way.

### 5. Run it

```bash
pnpm install
pnpm dev
```

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Dev server on :3000 |
| `pnpm build` | Production build (typechecks) |
| `pnpm test` | Vitest — the GST engine and validators |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |

## How it fits together

```
app/(marketing)   landing page, guest entry point
app/(auth)        login, signup, check-email, password reset
app/(setup)       onboarding wizard, guest account claim
app/(app)         dashboard, invoice builder, settings — gated
lib/tax.ts        the tax engine (pure, unit tested)
lib/money.ts      integer minor-unit arithmetic, amount in words
lib/validators.ts Zod schemas (internal) + Stripe-shaped wire schemas
lib/catalog/      products & prices (prod_… / price_… ids)
supabase/         schema, RLS, and the SQL functions
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
`owner_id = auth.uid()`. Guests get a real `auth.uid()` from anonymous sign-in,
so they're ordinary tenants with no special-casing anywhere.

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
