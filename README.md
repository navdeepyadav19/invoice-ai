# Invoice-AI

GST-compliant invoicing for Indian merchants and freelancers. Create an invoice
signed in or as a guest, get a PDF and a shareable link, and email it to your
client.

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
lib/gst.ts        the tax engine (pure, unit tested)
lib/money.ts      integer-paise arithmetic, amount in words
lib/validators.ts Zod schemas incl. GSTIN checksum
supabase/         schema, RLS, and the SQL functions
```

**The tax engine is the load-bearing part.** `lib/gst.ts` decides CGST+SGST vs
IGST from the supplier's state and the place of supply, computes in integer
paise, and is the same code the browser runs for the live preview and the server
runs before persisting. The server always recomputes and never trusts totals
from the client.

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

Two steps, and the first one is fifteen characters:

1. **Who are you?** "Do you have a GSTIN?" → enter it → we call the Sandbox GST
   API and prefill legal name, trade name, address, PIN, state and business type.
   No GSTIN? Enter a PAN and state and we try that; if nothing comes back (which
   is normal for a business that isn't registered) a short manual form appears.
2. **How do you get paid?** Account name, number, IFSC. Skippable.

Everything else — logo, signature, UPI, payment terms, default notes, invoice
numbering — has a sensible default and lives in **Settings → Business** instead.
None of it is worth standing between someone and their first invoice.

### Why "do you have a GSTIN?" and not "what type of business are you?"

GST registration in India is turnover-based, not entity-type-based: a sole trader
over ₹40L has a GSTIN, a small Pvt Ltd may not. And the PAN endpoint only returns
GSTINs for businesses that are *already registered*, so routing sole traders down
a PAN path returns `NOGSTIN` for exactly the people it was meant to help.

Asking about the GSTIN directly means the one question that actually predicts
whether we can prefill. Business type then comes free — the registry returns it
in the `ctb` field, so we never ask.

### Configuring GST lookup

Set `SANDBOX_API_KEY` and `SANDBOX_API_SECRET`. Without them the lookup step is
skipped and users type their details, so onboarding never hard-depends on a
third party being up. Three gotchas are handled in `lib/sandbox/client.ts`:
the token is **not** a Bearer token, failures arrive as **HTTP 200** with an
error body, and the PAN endpoint needs a **`state_code` query param**.

## AI invoice creation

Type or dictate "Invoice Sharma Traders ₹45,000 for brand design" and the
builder fills itself in. Set `OPENAI_API_KEY` to enable it; without the key the
prompt box simply doesn't render.

- **Voice** → `MediaRecorder` → `/api/ai/transcribe` → Whisper.
- **Text** → `/api/ai/parse-invoice` → `gpt-4o-mini` with a Zod schema.
- **Nothing is saved.** The parsed fields land in the form and the user reviews
  them; the normal autosave takes over from there.

Two things the model is deliberately not trusted with, both in
`lib/ai/normalise.ts`: converting a tax-inclusive amount back to a pre-tax rate
(arithmetic), and turning a spoken state name into a GST state code (a lookup it
would hallucinate, and a wrong code silently flips CGST/SGST to IGST).

## Emailing invoices

Optional — the app works fully without it, you just don't get the "Email it"
button. To enable:

1. Add a domain in Resend and verify its DNS records.
2. Set `RESEND_API_KEY` and `INVOICE_FROM_EMAIL` (an address on that domain).

Until a domain is verified, Resend only delivers to your own address from
`onboarding@resend.dev`.

## Not built yet

- Payment links (Stripe / Razorpay) and marking paid from a webhook
- Recurring invoices, credit notes, e-invoice IRN / e-way bill
- A saved client and line-item library for autofill
- Logo and signature upload UI (the storage bucket and policies exist; the
  invoice renders them when `logo_url` / `signature_url` are set)
