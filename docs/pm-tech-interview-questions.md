# Invoice-AI — 10 technical questions a PM should be able to answer

Study sheet for interviews when someone is reviewing this project. Answers are
grounded in the current codebase. Skim the **Where to look** links before you
interview; say these in your own words, not as a script.

> **Two things changed after this was written.** On 2026-09-20 the app went
> worldwide (commit `dc3eaac`): the GST engine (`lib/gst.ts`), GSTIN/PAN/IFSC
> validation and the Sandbox GSTIN lookup were deleted, replaced by a generic
> exclusive tax engine in `lib/tax.ts`, a country + currency per business, and
> an optional free-text tax ID. On 2026-10-04 the backend moved from Supabase to
> Neon, and guest mode went with it. Answers that describe the GST era are kept
> because they are still good interview material, but each one is marked with
> what is true today. Files that no longer exist are in git history before
> `dc3eaac`.

---

## 1. Who is the source of truth for invoice totals — the browser or the server?

**Good answer**

Both run the same tax engine for the live preview, but the **server is the
source of truth when we save**. The builder calls `computeInvoice` in the
browser so the user sees the tax and total update as they type (in the GST era,
the CGST/SGST/IGST split). On save, the server
action **recomputes every total from the line items** and ignores whatever
totals the client sent. A tampered request can change *what* is billed (that’s
the user’s own draft), but it can’t store a document whose tax doesn’t follow
from its own lines — which is what has to hold up against a tax filing.

**Why it matters as a PM**

You’re treating tax correctness as a product invariant, not a UI nicety. Wrong
money on an invoice is a P0; a slightly laggy preview is not.

**Where to look**

- `lib/tax.ts` — shared engine; comments on server recompute
- `lib/actions/invoice.ts` — `saveInvoiceDraft`, which calls
  `lib/services/invoices.ts` to recompute before persisting
- `components/invoice/builder.tsx` — live preview via the same `computeInvoice`

---

## 2. How do you decide CGST+SGST vs IGST (and the other tax treatments)?

> **Since the worldwide release (Sep 2026):** the app no longer does this.
> `lib/tax.ts` charges one free-form exclusive rate per line, in any currency;
> there are no treatments, no place of supply and no CGST/SGST/IGST split. The
> answer below is how the India-only version worked. The today answer is “I
> dropped the GST engine to sell outside India, and kept the invariants: integer
> minor units, server recompute.”

**Good answer (GST era)**

The engine picks a **tax treatment** from supply context, in a fixed order:

1. **Unregistered** — supplier isn’t GST-registered → Bill of Supply, no tax
2. **Export** — export flag or place-of-supply code `96` → zero-rated (LUT)
3. Else compare **supplier state** vs **place of supply**:
   - Same state → **intra_state** → CGST + SGST (half each)
   - Different states → **inter_state** → single **IGST** at the full rate

There’s also **reverse charge**: the recipient pays tax to the government, so
we show taxable value but the supplier collects none. Order matters — if we
checked geography before registration or export, we’d mis-tax unregistered
sellers and exports.

**Where to look**

- Git history before `dc3eaac`: `lib/gst.ts` (`resolveTreatment`,
  `computeInvoice`, `TaxTreatment`) and `lib/gst.test.ts`
- `lib/tax.ts` and `lib/tax.test.ts` — the engine that replaced it

---

## 3. How is a guest’s data kept separate, and what happens when they claim an account?

> **Since the move to Neon (Oct 2026):** guest mode is gone. Neon’s managed
> auth has no anonymous users, so everyone signs up first. The answer below is
> how it worked on Supabase, and is still a good answer to “what did you trade
> away by switching backends?” — the RLS half of it is unchanged, with
> `app.uid()` in place of `auth.uid()`.

**Good answer (Supabase era)**

A guest is not a shared scratchpad. “Create an invoice” does Supabase
**anonymous sign-in** — a real auth user with a real `uid` and JWT, just no
email yet. Every business/client/invoice row is keyed by `owner_id`, and
**Row Level Security** only allows `owner_id = auth.uid()`. Guests use the same
rule as registered users; there’s no special guest table.

**Claim — happy path:** attach email + password to the *same* auth user
(`updateUser`). The uid never changes, so invoices don’t move.

**Claim — email already taken:** we can’t merge two auth users. While still
signed in as the guest, we mint a short-lived **merge token** (proof of
ownership under RLS), stash it in a cookie, send them to sign in as the
existing account, then **re-parent** businesses/clients/invoices onto that
account’s uid and consume the token so it can’t be replayed.

**Where to look**

- Git history before the Neon migration (`a314f67`): `lib/actions/claim.ts`,
  `continueAsGuestAction`, and the `merge_tokens` table in
  `supabase/migrations/0001_init.sql`
- `db/migrations/0001_init.sql` — the RLS policies that still apply, now on
  `app.uid()`

---

## 4. Why does the app compute money in integer paise instead of floating-point rupees?

> **Since the worldwide release (Sep 2026):** same idea, any currency. The app
> computes in integer **minor units** (`toMinor` / `mulMinor` in `lib/money.ts`;
> the `…Paise` names are kept as aliases), respects each currency’s decimals
> (`lib/currency.ts`), and formats per locale. There is no CGST/SGST split to
> round any more.

**Good answer**

Invoice math sums many small amounts (line tax, discounts, round-off) that must
reconcile to the paisa for GST filings. IEEE-754 floats famously break
`0.1 + 0.2 === 0.3`. We convert to **integer paise** at the boundary, do all
arithmetic in integers, and convert back only for display. Postgres stores
amounts as `numeric(14,2)` — exact decimal — matching that boundary.

CGST/SGST splitting is careful too: we round one half and derive the other by
subtraction so `cgst + sgst` always equals the total tax even on odd paise.

**Where to look**

- `lib/money.ts` — `toMinor`, `mulMinor`, `formatMinor`
- `lib/tax.ts` — the per-line computation in minor units
- `db/migrations/0001_init.sql` — money as `numeric(14,2)`, never float

---

## 5. What are business and client “snapshots,” and why do invoices freeze them?

**Good answer**

When we save an invoice, the server stores **JSONB copies** of the business (“From”) and
client (“Bill to”) as they stood at that moment — `business_snapshot` and
`client_snapshot`. Live profile rows can change later (new address, new trade
name). Without snapshots, editing your address would silently rewrite every
invoice you already issued. A real invoice is a point-in-time legal document;
snapshots make the data model match that product rule.

**Where to look**

- `db/migrations/0001_init.sql` — schema comments on snapshots
- `lib/services/invoices.ts` — writes `business_snapshot` / `client_snapshot` on save
- `lib/invoice-view.ts` — `snapshotBusiness` helper
- README — “Invoices freeze their parties”

---

## 6. How do you keep one merchant from seeing another merchant’s invoices?

**Good answer**

**Tenant isolation lives in the database (RLS), not in “remember to filter in
the app.”** Every sensitive table keys off `owner_id`. Policies allow access
only when `owner_id = app.uid()`. Invoice line items and events are gated
through their parent invoice’s owner. The database is only reachable from the
server: `lib/db/scoped.ts` opens a transaction, runs `SET LOCAL ROLE
authenticated`, and pins the caller’s user id, so the same policies apply to a
browser session, an API key and the CLI.

> **Since the move to Neon (Oct 2026):** this used to read `auth.uid()` from a
> Supabase JWT, and guests were ordinary tenants with an anonymous uid. There are
> no guests now, so the old “captcha on anonymous sign-in” point becomes
> “rate-limit and captcha the public sign-up form”.

**Where to look**

- `db/migrations/0001_init.sql` — design notes at top + RLS policies
- README — “Tenant isolation is RLS, not application code”
- `lib/db/scoped.ts` — how the signed-in user reaches the DB (role switch + `app.uid()`)

---

## 7. How does invoice numbering work, and why isn’t it a simple database sequence?

**Good answer**

Numbers are **per business**, not global: prefix + zero-padded sequence, e.g.
`INV-0042`. A single Postgres `SEQUENCE` is the wrong tool for multi-tenant
numbering, and it leaves gaps on rollback. Instead, finalizing a draft calls the
SQL function `issue_invoice()`, which in **one transaction** locks the invoice
row, refuses an empty or non-draft invoice, calls `claim_invoice_number` (which
increments `businesses.next_invoice_number` with `UPDATE … RETURNING`), stores
the number, moves the invoice `draft → open`, and writes a `finalized` event.
Because claim and save are one statement, two clicks or two API retries can’t
burn two numbers, and a second call just returns the number already assigned.

It’s wired end to end: **Issue invoice** (or **Email it**) in the builder, and
`POST /api/v1/invoices/{id}/finalize` or `/send` in the API.

> **Since the worldwide release (Sep 2026):** numbers used to carry the Indian
> financial year (`INV/25-26/0001`). Migration `0009` switched new numbers to
> `PREFIX-0001`; numbers already issued were left as they were.

**Where to look**

- `db/migrations/0011_stripe_api.sql` — current `issue_invoice()` (first
  version in `0004_foundation.sql`, whose header explains the race it fixes)
- `db/migrations/0009_global_breaking.sql` — current `claim_invoice_number`
- `lib/services/invoices.ts` — `finalize()`; `lib/actions/send.ts` — the UI action
- `components/invoice/send-controls.tsx` — the Issue invoice / Email it buttons

---

## 8. How do you validate a GSTIN, and why isn’t a regex enough?

> **Since the worldwide release (Sep 2026):** the app no longer validates
> GSTINs. The tax ID is optional free text (VAT, EIN, GSTIN, ABN…), and
> migration `0009` dropped the `businesses_gstin_*` checks. Use the answer below
> as “how I handled a domain rule when I had one”; the code is in git history
> before `dc3eaac`.

**Good answer (GST era)**

A GSTIN is 15 characters with a known shape (state code + PAN + entity + `Z` +
check character). We validate shape with a regex, then run the **official
checksum** over the first 14 characters. A transposed digit can pass the regex
and still be wrong; a bad GSTIN on an issued invoice becomes a messy correction
for the merchant. On the business side, if you’re GST-registered, the DB also
enforces that the GSTIN’s state digits match `state_code` — so no code path
(server action, SQL console, future import) can save an inconsistent registration.

**Where to look**

- Git history before `dc3eaac`: `lib/validators.ts` (`GSTIN_REGEX`,
  `hasValidGstinChecksum`) and `lib/validators.test.ts`
- `db/migrations/0001_init.sql` — `businesses_gstin_matches_state` check, dropped
  in `0009_global_breaking.sql`

---

## 9. What’s intentionally not shipped yet, and how did you sequence the MVP?

> **Since this was written:** the send loop shipped. Issuing (`draft → open`
> with a number), the PDF, the public share page and email via Resend all work
> now, along with a public REST API, webhooks, products & prices, and a CLI.
> The sequencing story below is still the right answer to “how did you
> sequence the MVP?”; for “what’s not built?” use README → “Not built yet”.

**Good answer (MVP sequencing)**

Working first: auth, onboarding, the tax engine with tests, the draft invoice
builder with live tax, persistence, RLS, snapshots.

**Built after that:**

- PDF generation (`/api/invoices/[id]/pdf`)
- Public share page (`/i/[token]`)
- Emailing via Resend
- Issuing: `issue_invoice()` + status `draft → open`

Sequencing logic: the landing page sells the *job* (PDF + share + email), but
we shipped **correct tax + durable drafts + identity** first. A pretty wrong
invoice is worse than a missing download button. The send loop came next, once
the engine and data model held.

**Not built yet today:** payment links, marking paid from a webhook, recurring
billing runs, credit notes. Marking paid and voiding exist in the API and CLI
but have no button in the app yet.

**Where to look**

- README — “Not built yet”
- `lib/tax.test.ts` — evidence the tax layer was treated as load-bearing

---

## 10. What’s the stack, and why these choices for this product?

**Good answer**

- **Next.js (App Router) + React + TypeScript** — one codebase for marketing,
  auth, builder, and server actions; good fit for a PM-built product where UI
  and domain logic stay close.
- **Neon (Postgres + Neon Auth + RLS)** — database, managed Better Auth, and
  tenant isolation in one Postgres; RLS still does the isolation, with the app
  pinning the user per transaction. Moved from Supabase because its free tier
  pauses idle projects, while Neon scales compute to zero instead.
- **Kysely + pg** — typed SQL against Neon; `lib/db/` is the only way in.
- **Zod validators + pure tax/money modules** — domain rules unit-tested without
  the framework; browser and server can share the same functions.
- **Tailwind / shadcn** — fast UI for forms and app shell without a design system
  project of its own.
- Delivery: **@react-pdf/renderer** for PDFs, **Resend** for email.

I’m not claiming this is the only valid stack — I’m claiming it matches the
product constraints: money and tax logic that must be exact, multi-tenant data,
a short sign-up path, and a small team (or solo PM) shipping end-to-end.

**Where to look**

- `package.json` — dependencies and scripts
- `README.md` — setup and architecture sketch
- `app/(marketing)`, `app/(auth)`, `app/(setup)`, `app/(app)` — route groups
- `proxy.ts` — Next 16 proxy (formerly middleware): sends signed-out visitors
  to `/login` and finishes Google sign-in

---

## Quick drill (30 seconds each)

| # | Prompt | One-liner |
|---|--------|-----------|
| 1 | Source of truth for totals? | Server recomputes; client preview only |
| 2 | CGST vs IGST? | GST era: same state vs different place of supply. Today: one exclusive rate per line |
| 3 | Guest isolation? | Supabase era: real uid + RLS, claim or merge. Today: no guests |
| 4 | Why integer minor units? | No float money bugs; filing-grade precision |
| 5 | Snapshots? | Freeze parties so edits don’t rewrite old invoices |
| 6 | Multi-tenant security? | RLS on `owner_id = app.uid()`, role pinned per transaction |
| 7 | Invoice numbers? | Per-business `PREFIX-0001`, claimed and saved in one locked `issue_invoice()` |
| 8 | GSTIN? | GST era: regex + checksum + state match. Today: free-text tax ID |
| 9 | What’s missing? | Payment links, recurring runs, credit notes; mark-paid/void UI |
| 10 | Stack? | Next + Neon (Postgres + Auth) + Kysely + shared tax engine |

---

## How to practice

1. Open each **Where to look** file and find the comment or function named above.
2. Answer out loud in under 90 seconds without reading.
3. Always add one sentence of **product judgment** (“why we cared”) after the
   technical fact — that’s what separates a PM answer from an eng dump.
