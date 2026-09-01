# Invoice-AI — 10 technical questions a PM should be able to answer

Study sheet for interviews when someone is reviewing this project. Answers are
grounded in the current codebase. Skim the **Where to look** links before you
interview; say these in your own words, not as a script.

---

## 1. Who is the source of truth for invoice totals — the browser or the server?

**Good answer**

Both run the same tax engine for the live preview, but the **server is the
source of truth when we save**. The builder calls `computeInvoice` in the
browser so the user sees CGST/SGST/IGST update as they type. On save, the server
action **recomputes every total from the line items** and ignores whatever
totals the client sent. A tampered request can change *what* is billed (that’s
the user’s own draft), but it can’t store a document whose tax doesn’t follow
from its own lines — which is what has to hold up against a GST filing.

**Why it matters as a PM**

You’re treating tax correctness as a product invariant, not a UI nicety. Wrong
money on an invoice is a P0; a slightly laggy preview is not.

**Where to look**

- `lib/gst.ts` — shared engine; comments on server recompute
- `lib/actions/invoice.ts` — `saveInvoiceDraft` recomputes before persist
- `components/invoice/builder.tsx` — live preview via the same `computeInvoice`

---

## 2. How do you decide CGST+SGST vs IGST (and the other tax treatments)?

**Good answer**

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

- `lib/gst.ts` — `resolveTreatment`, `computeInvoice`, `TaxTreatment`
- `lib/gst.test.ts` — cases for intra, inter, export, unregistered, reverse charge

---

## 3. How is a guest’s data kept separate, and what happens when they claim an account?

**Good answer**

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

- `lib/actions/auth.ts` — `continueAsGuestAction` / `signInAnonymously`
- `lib/actions/claim.ts` — `claimAccountAction`, `mergePendingGuestData`
- `supabase/migrations/0001_init.sql` — RLS policies, `merge_tokens`,
  `redeem_merge_token`
- README — anonymous sign-ins must be enabled in Supabase

---

## 4. Why does the app compute money in integer paise instead of floating-point rupees?

**Good answer**

Invoice math sums many small amounts (line tax, discounts, round-off) that must
reconcile to the paisa for GST filings. IEEE-754 floats famously break
`0.1 + 0.2 === 0.3`. We convert to **integer paise** at the boundary, do all
arithmetic in integers, and convert back only for display. Postgres stores
amounts as `numeric(14,2)` — exact decimal — matching that boundary.

CGST/SGST splitting is careful too: we round one half and derive the other by
subtraction so `cgst + sgst` always equals the total tax even on odd paise.

**Where to look**

- `lib/money.ts` — `toPaise`, `mulPaise`, formatting with Indian digit grouping
- `lib/gst.ts` — CGST/SGST split comment around odd paise
- `supabase/migrations/0001_init.sql` — money as `numeric(14,2)`, never float

---

## 5. What are business and client “snapshots,” and why do invoices freeze them?

**Good answer**

When we save an invoice, we store **JSONB copies** of the business (“From”) and
client (“Bill to”) as they stood at that moment — `business_snapshot` and
`client_snapshot`. Live profile rows can change later (new address, new trade
name). Without snapshots, editing your address would silently rewrite every
invoice you already issued. A real invoice is a point-in-time legal document;
snapshots make the data model match that product rule.

**Where to look**

- `supabase/migrations/0001_init.sql` — schema comments on snapshots
- `lib/actions/invoice.ts` — writes `business_snapshot` / `client_snapshot` on save
- `lib/invoice-view.ts` — `snapshotBusiness` helper
- README — “Invoices freeze their parties”

---

## 6. How do you keep one merchant from seeing another merchant’s invoices?

**Good answer**

**Tenant isolation lives in the database (RLS), not in “remember to filter in
the app.”** Every sensitive table keys off `owner_id`. Policies allow access
only when `owner_id = auth.uid()`. Invoice line items and events are gated
through their parent invoice’s owner. Guests get a real `auth.uid()`, so they’re
ordinary tenants — no second security model.

As a PM I’d still want captcha on anonymous sign-in before public traffic,
because anonymous auth is an unauthenticated user-creation endpoint — but the
isolation model itself doesn’t special-case guests.

**Where to look**

- `supabase/migrations/0001_init.sql` — design notes at top + RLS policies
- README — “Tenant isolation is RLS, not application code”
- `lib/supabase/*` — how the session reaches the DB

---

## 7. How does invoice numbering work, and why isn’t it a simple database sequence?

**Good answer**

Numbers are **per business**, not global: prefix + Indian financial year
(April–March) + padded sequence, e.g. `INV/25-26/0001`. A single Postgres
`SEQUENCE` is the wrong tool for multi-tenant numbering. Instead,
`claim_invoice_number` locks the business row, increments `next_invoice_number`,
and returns the formatted string. The row lock serializes two “send” clicks at
the same instant so they can’t get the same number.

**Status note for honesty:** claiming a number and moving `draft → sent` is
designed in SQL but **not fully wired in the product UI yet** (see README “Not
built yet”). You can talk about the design and the gap without overselling.

**Where to look**

- `supabase/migrations/0001_init.sql` — `claim_invoice_number`, FY logic
- `businesses.invoice_prefix` / `next_invoice_number` columns
- README — Not built yet: sending / claiming number

---

## 8. How do you validate a GSTIN, and why isn’t a regex enough?

**Good answer**

A GSTIN is 15 characters with a known shape (state code + PAN + entity + `Z` +
check character). We validate shape with a regex, then run the **official
checksum** over the first 14 characters. A transposed digit can pass the regex
and still be wrong; a bad GSTIN on an issued invoice becomes a messy correction
for the merchant. On the business side, if you’re GST-registered, the DB also
enforces that the GSTIN’s state digits match `state_code` — so no code path
(server action, SQL console, future import) can save an inconsistent registration.

**Where to look**

- `lib/validators.ts` — `GSTIN_REGEX`, `hasValidGstinChecksum`, cross-field rules
- `lib/validators.test.ts` — checksum / registration tests
- `supabase/migrations/0001_init.sql` — `businesses_gstin_matches_state` check

---

## 9. What’s intentionally not shipped yet, and how did you sequence the MVP?

**Good answer**

Working today: guest entry, auth (email/Google/claim), onboarding, GST engine
with tests, draft invoice builder with live tax, persistence, RLS, snapshots.

**Not built yet** (called out in README):

- PDF generation (`/api/invoices/[id]/pdf`)
- Public share page (`/i/[token]`)
- Emailing via Resend
- Issuing: `claim_invoice_number` + status `draft → sent`

Sequencing logic: the landing page sells the *job* (PDF + share + email), but
we shipped **correct tax + durable drafts + identity** first. A pretty wrong
invoice is worse than a missing download button. Next product bet is closing
the send loop (number → PDF/share/email) now that the engine and data model hold.

**Where to look**

- README — “Not built yet”
- `package.json` — `@react-pdf/renderer`, `resend` already present as deps
- `lib/gst.test.ts` — evidence the tax layer was treated as load-bearing

---

## 10. What’s the stack, and why these choices for this product?

**Good answer**

- **Next.js (App Router) + React + TypeScript** — one codebase for marketing,
  auth, builder, and server actions; good fit for a PM-built product where UI
  and domain logic stay close.
- **Supabase (Auth + Postgres + RLS)** — auth (including anonymous), database,
  and tenant isolation in one place; guests and registered users share one model.
- **Zod validators + pure GST/money modules** — domain rules unit-tested without
  the framework; browser and server can share the same functions.
- **Tailwind / shadcn** — fast UI for forms and app shell without a design system
  project of its own.
- Planned delivery: **@react-pdf/renderer** for PDFs, **Resend** for email.

I’m not claiming this is the only valid stack — I’m claiming it matches the
product constraints: Indian GST domain logic, multi-tenant data, low-friction
guest → account path, and a small team (or solo PM) shipping end-to-end.

**Where to look**

- `package.json` — dependencies and scripts
- `README.md` — setup and architecture sketch
- `app/(marketing)`, `app/(auth)`, `app/(setup)`, `app/(app)` — route groups
- `proxy.ts` — Next 16 session refresh (formerly middleware)

---

## Quick drill (30 seconds each)

| # | Prompt | One-liner |
|---|--------|-----------|
| 1 | Source of truth for totals? | Server recomputes; client preview only |
| 2 | CGST vs IGST? | Same state vs different place of supply |
| 3 | Guest isolation? | Real uid + RLS; claim keeps uid or merges via token |
| 4 | Why paise? | No float money bugs; filing-grade precision |
| 5 | Snapshots? | Freeze parties so edits don’t rewrite old invoices |
| 6 | Multi-tenant security? | RLS on `owner_id = auth.uid()` |
| 7 | Invoice numbers? | Per-business, FY-aware, row-locked claim |
| 8 | GSTIN? | Regex + checksum + state match in DB |
| 9 | What’s missing? | PDF, public link, email, draft→sent |
| 10 | Stack? | Next + Supabase + shared GST engine |

---

## How to practice

1. Open each **Where to look** file and find the comment or function named above.
2. Answer out loud in under 90 seconds without reading.
3. Always add one sentence of **product judgment** (“why we cared”) after the
   technical fact — that’s what separates a PM answer from an eng dump.
