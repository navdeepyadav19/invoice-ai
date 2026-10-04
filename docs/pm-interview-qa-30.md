# Invoice-AI — PM interview Q&A (30 questions)

Portfolio prep: short spoken answers. For technical questions, the **Depth**
block is 2–3 extra lines if they push. Say these in your own words.

> **Two things changed after this was written.** On 2026-09-20 the app went
> worldwide (commit `dc3eaac`): country + currency per business, a generic
> exclusive tax engine (`lib/tax.ts`) in place of the GST engine, and an
> optional free-text tax ID instead of GSTIN validation. On 2026-10-04 the
> backend moved from Supabase to Neon and guest mode went away. India/GST
> answers are kept because the reasoning still interviews well; the notes say
> what is true today. Old code is in git history before `dc3eaac`.

---

## Problem, users, positioning

### 1. What problem does Invoice-AI solve?

> **Since the worldwide release (Sep 2026):** the user is any freelancer or small business, in any country and currency, who needs a correct invoice, a PDF and a link fast. The GST framing below was the India-only v1.

**Answer (GST era):** Indian freelancers and small merchants need a GST-correct invoice fast — without opening a spreadsheet or a full accounting suite. The job is: fill details → tax split done right → send to client.

### 2. Who is the target user?

**Answer:** Primary: freelancers and solo merchants who bill irregularly and care about GST compliance. Secondary: tiny agencies with a handful of clients. Not CFOs or companies that need full books and GST returns.

### 3. Why not Zoho / QuickBooks / Excel?

**Answer:** Those tools optimize for bookkeeping and multi-user finance. I optimized for *time-to-correct-invoice*. Excel makes you own CGST vs IGST; big suites force setup I don’t need for a one-off bill.

### 4. What’s your unique value proposition?

**Answer:** GST math + low friction. Sign-up is one screen (or Google) with no verification wall, then a two-step onboarding; tax treatment (intra/inter/export/unregistered) is computed for you; drafts persist under real tenant isolation.

### 5. How did you discover this problem?

**Answer:** Personal pain first — I needed to invoice clients without fighting templates and tax rules. I treated myself as the ICP, then generalized to “anyone who bills occasionally under Indian GST.”

### 6. What’s out of scope on purpose?

**Answer:** Accounting ledgers, tax-return filing, inventory, multi-entity finance teams, payroll. Not built yet: payment links, recurring billing runs, credit notes. (PDF, public share link, email send and draft→open numbering have shipped since this was first written.)

---

## Strategy, prioritization, trade-offs

### 7. How did you prioritize the MVP?

**Answer:** Ship the load-bearing risk first: correct GST engine, durable drafts, identity (guest + claim on Supabase; sign-up-first since the move to Neon), tenant isolation. Distribution features (PDF/email/share) sell the job on the landing page but come after money/tax is trustworthy.

### 8. What’s the biggest product trade-off you made?

> **Since the move to Neon (Oct 2026):** I reversed this one. Neon’s managed auth has no anonymous users, so keeping guest mode meant building our own anonymous-user layer. I went sign-up-first and paid for the friction elsewhere: one-screen sign-up or Google, no email-verification wall (a banner asks later), a two-step resumable onboarding. Same trade-off — activation vs account friction — I just moved where I pay for it.

**Answer (Supabase era):** Guest mode without signup. Wins activation (time to first draft). Costs: abuse risk on anonymous auth, “where’s my data?” UX, and a merge path when the email already exists. I chose activation over perfect account hygiene for v1.

### 9. If you had two more weeks, what would you build next?

> **Since this was written:** the send loop below shipped (Issue invoice, PDF, share link, email). Today’s answer: “Get paid” — payment links and marking an invoice paid from a payment webhook, plus mark-paid / void buttons in the app (the API and CLI already do both).

**Answer (MVP era):** Close the send loop: claim invoice number + draft→sent, then PDF, then share link / email. That’s what turns a correct draft into a completed job.

### 10. What would you cut if you had to launch tomorrow?

**Answer:** Keep tax engine, save draft, sign-up/login, basic builder. Cut polish: fancy marketing, multiple onboarding paths, Google login if needed — not tax correctness or save.

### 11. How would you monetize this?

**Answer:** Freemium: free tier with limited invoices; paid for unlimited invoices, PDF branding, email send, and saved clients. Price for freelancers (low monthly), not enterprise seats. Avoid competing with full accounting suites on price.

### 12. Who are your competitors and how do you win?

**Answer:** Excel/templates (default), ClearTax-style tools, Zoho Books, etc. Win on speed and GST clarity for occasional billers — not on GSTR depth. Positioning: “invoice in a minute,” not “replace your CA software.”

### 13. What’s the biggest risk to this product?

**Answer:** Wrong tax = lost trust (and legal pain for the user). Secondary: sign-up friction (there’s no guest mode, so people create an account before they see the builder), and users bouncing between drafting and sending. Domain accuracy and completion rate matter more than feature count.

---

## Metrics, feedback, iteration

### 14. How do you measure success?

**Answer:** Activation (landing → sign-up → onboarding done → first draft), quality (drafts with coherent tax treatment), sign-up conversion (landing → account — the step that costs most now there’s no guest mode), retention (second invoice in 30 days), and the send loop: draft → issued, PDF downloaded, email or share link used (the `invoice_events` table records `finalized`, `downloaded`, `emailed`, `viewed`).

### 15. What’s your north-star metric?

**Answer:** **Correct invoices successfully sent per active user per month.** Drafts alone aren’t the job; sending a GST-correct invoice is.

### 16. How would you run user research on this?

**Answer:** Watch 5 freelancers create one real invoice end-to-end; note where they freeze (GSTIN, place of supply, HSN). Pair with support tickets on tax confusion. Avoid surveys about “features” until the send loop exists.

### 17. Tell me about a bug or failure that taught you something.

**Answer:** (Use a real one if you have it.) Framing: autosave creating duplicate clients, or Base UI API shifts — lesson was treat data model and domain tests as product quality, not “eng cleanup.” Wrong persisted money is a product incident.

---

## UX and product sense

### 18. Why allow creating an invoice without signing up?

> **Since the move to Neon (Oct 2026):** we don’t any more — everyone signs up first, because Neon’s managed auth has no anonymous users. The reasoning below is still why sign-up is kept as short as possible: one screen or Google, straight into onboarding, email verified later from a banner. The landing page shows a sample invoice so value is visible before the form.

**Answer (Supabase era):** Signup before value kills activation for a tool people use infrequently. Show the product (builder + tax preview) first; claim account when they want to keep invoices.

### 19. Why is onboarding different for guests vs signed-up users?

> **Since the move to Neon (Oct 2026):** it isn’t — there are no guests, so everyone gets the same two-step wizard (who you are, how you get paid) right after sign-up. It stays short because anything with a sane default lives in settings, and `onboarding_step` is saved server-side so closing the tab loses nothing.

**Answer (Supabase era):** Guests enter business details inline in the builder — a wizard before they’ve seen value is the friction guest mode exists to remove. Registered users get a short wizard so the “From” side is complete before heavy use. On claim, we mark onboarding done so they don’t retype.

### 20. How do you keep the builder from feeling like CA software?

**Answer:** Progressive disclosure: essentials first (client, lines, tax rate), live tax preview so they don’t calculate by hand, sensible defaults from the business (country, currency, payment terms). In the GST era this also meant hiding export/reverse charge until needed.

---

## Technical (crisp + depth)

### 21. What’s the tech stack and why?

**Answer:** Next.js + React + TypeScript, Neon (Postgres + Neon Auth + RLS) with Kysely, Zod validators, pure tax/money modules, Tailwind/shadcn, `@react-pdf/renderer` for PDFs and Resend for email.

**Depth:** One codebase covers marketing, auth, and server actions. Every query runs in a transaction that does `SET LOCAL ROLE authenticated` and sets `app.uid()` to the caller, so RLS isolates tenants the same way for browser sessions, API keys and the CLI. Moved from Supabase because its free tier pauses idle projects; Neon scales compute to zero instead. Domain logic (`lib/tax.ts`, `lib/money.ts`) is framework-free and unit-tested so browser preview and server save share one engine.

### 22. Who is the source of truth for invoice totals?

**Answer:** The server. Preview can run in the browser; on save we recompute and store server totals.

**Depth:** `saveInvoiceDraft` hands the lines to `lib/services/invoices.ts`, which runs `computeInvoice` and ignores client-sent totals. A user can change what they bill, but they can’t persist tax that doesn’t follow from those lines — important for filing-grade consistency.

### 23. How do CGST/SGST vs IGST work in the product?

> **Since the worldwide release (Sep 2026):** they don’t any more. `lib/tax.ts` applies one free-form exclusive rate per line in any currency; no treatments, no place of supply. The answer below is the India-only engine (`lib/gst.ts`, in git history before `dc3eaac`).

**Answer (GST era):** Same supplier state and place of supply → CGST+SGST; different → IGST. Unregistered → no tax; export → zero-rated.

**Depth:** `resolveTreatment` checks registration, then export (incl. POS `96`), then state equality. Intra-state splits tax in half carefully so CGST+SGST always equals total tax even on odd paise. Reverse charge shows taxable value but collects no tax from the buyer on the invoice.

### 24. Why integer paise instead of floating rupees?

**Answer:** Avoid float rounding bugs; invoices must reconcile to the paisa.

**Depth:** Convert at the boundary with `toMinor` / `mulMinor` (the old `toPaise` / `mulPaise` names are aliases), compute in integers, display with the currency’s own decimals and locale. DB stores `numeric(14,2)`. Same reason banks and GST tools don’t use IEEE floats for money.

### 25. How is multi-tenant security handled?

**Answer:** Postgres Row Level Security: each row’s `owner_id` must equal `app.uid()`. App code isn’t the only gate.

**Depth:** The driver (`lib/db/scoped.ts`) switches to the `authenticated` role and sets `app.uid()` inside each transaction, so no caller can forget it. (On Supabase this was `auth.uid()` from the JWT.) Policies cover businesses, clients, invoices, items, events. Isolation fails closed at the DB even if a future API forgets a filter.

### 26. How does guest → permanent account work?

> **Since the move to Neon (Oct 2026):** this path no longer exists. With no guest mode there’s nothing to claim or merge; an account is permanent from sign-up. Keep the answer below for “what did you trade away by switching backends?”

**Answer (Supabase era):** Usually attach email/password to the same user id. If email exists, merge guest rows into the existing account via a short-lived token.

**Depth (Supabase era):** Happy path: `updateUser` — uid unchanged, no row migration. Collision: mint `merge_tokens` while still the guest (RLS allows it), cookie the token, sign in as existing user, `redeem_merge_token` re-parents businesses/clients/invoices and consumes the token.

### 27. What are invoice snapshots?

**Answer:** Frozen JSON copies of business and client on the invoice so later profile edits don’t rewrite old invoices.

**Depth:** `business_snapshot` / `client_snapshot` are written on save. Product rule: an issued invoice is a point-in-time document. Live `businesses`/`clients` tables remain for the next draft.

### 28. How do invoice numbers work?

**Answer:** Per-business sequence (`PREFIX-0001`), assigned only when a draft is issued, and claimed and saved in one locked transaction so two clicks can’t burn or share a number.

**Depth:** The SQL function `issue_invoice()` locks the invoice row, refuses an empty or non-draft invoice, calls `claim_invoice_number` (which bumps `businesses.next_invoice_number` with `UPDATE … RETURNING`), stores the number, moves the invoice `draft → open` and logs a `finalized` event. A repeat call returns the existing number. It’s live in the UI as **Issue invoice** / **Email it** in the builder, and in the API as `POST /invoices/{id}/finalize` or `/send`. Current definitions: `issue_invoice()` in `db/migrations/0011_stripe_api.sql` (introduced in `0004_foundation.sql`), `claim_invoice_number` in `0009_global_breaking.sql`.

> **Since the worldwide release (Sep 2026):** numbers used to embed the Indian financial year (`INV/25-26/0001`, April–March). Migration `0009` switched new numbers to `PREFIX-0001` and left issued numbers alone.

### 29. How do you validate GSTIN?

> **Since the worldwide release (Sep 2026):** we don’t. The tax ID is optional free text (VAT, EIN, GSTIN, ABN…), and migration `0009` dropped `businesses_gstin_matches_state`. Use this as “how I treated a domain rule as a product feature”.

**Answer (GST era):** Format check plus checksum; registered businesses must have GSTIN matching their state code.

**Depth:** Regex catches shape; checksum catches transposed digits. DB check `businesses_gstin_matches_state` enforces consistency even outside the app. Wrong GSTIN on a sent invoice is costly for the merchant — validation is a product feature.

### 30. How do you work with engineering on something this domain-heavy?

**Answer:** I write acceptance cases (same-state, cross-state, export, unregistered, reverse charge, discounts) and non-negotiables (server recomputes, paise math, RLS, snapshots). “Done” means those pass, not that the form looks finished.

**Depth:** Pure tax engine + Vitest lets PM and eng share a contract without debating UI. Prioritize P0 tax bugs over P2 polish. Captcha or rate limits on public sign-up before launch traffic is a checklist item, not an afterthought.

---

## Bonus rapid-fire (if they keep going)

| Q | Crisp answer |
|---|--------------|
| Why India-first? | It was: GST rules were the hard problem and my own pain. In Sep 2026 I went worldwide — generic tax engine, any currency — because the invariants (server recompute, integer money, snapshots) didn’t depend on GST. |
| Mobile? | Builder should work on phone for freelancers on the go; v1 prioritizes correctness over native apps. |
| Data privacy? | Tenant RLS; no sharing with third parties for ads; delete path via the account. |
| Why Next.js 16 proxy? | Ex-middleware: sends signed-out visitors to login (an optimistic gate — RLS is the real one) and finishes Google sign-in with Neon Auth; skips static assets. |
| Amount in words? | Required on many Indian invoices; `amountInWords` in `lib/money.ts` generates it from minor units, per currency. |

---

## How to use this in the interview

1. Lead with **user + job** (Q1–Q4), then **trade-off** (Q8), then **one technical invariant** (Q22 or Q25).
2. Always add one line of judgment: “I chose X because Y.”
3. Be honest about **not built yet** (payment links, recurring runs, credit notes — see README) — it shows sequencing maturity, not weakness.
