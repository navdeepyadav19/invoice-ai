# QA Test Cases — Invoice-AI

Twenty scenarios QA runs before every release. They are written to be executed in a
real browser via **Playwright MCP in Claude Code**, but each one is readable and
runnable by hand.

Coverage is deliberately weighted towards the app's *invariants* rather than its
happy paths, because that is where this product breaks in ways a customer would
have to explain to their accountant:

- tax follows from the line items, never from what the client posted;
- an invoice number is claimed once, on send, and never re-used;
- an issued invoice is frozen;
- one tenant never sees another's data.

---

## Before you start

### Environment

| Item | Value |
| --- | --- |
| Base URL | `http://localhost:3000` (`pnpm dev`) |
| Required env | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEXT_PUBLIC_SITE_URL` |
| Optional env | `OPENAI_API_KEY` (TC-16/17), `RESEND_API_KEY` + `INVOICE_FROM_EMAIL` (TC-18 email), `SANDBOX_API_KEY`/`SANDBOX_API_SECRET` (TC-07 prefill) |
| Database | `.env.local` points at the Neon **`dev`** branch, never production (`main`) — see `docs/neon-overview.md` |
| Neon Auth trusted domains | `localhost` is allowed by default; any other origin you test from (a preview URL, a LAN IP) must be added to Neon Auth's trusted domains |

Cases marked **[needs key]** degrade to an assertion about the *fallback* path when
the key is absent — that is a valid run, not a skip. Record which branch you took.

### Test data

GSTINs below are checksum-valid against `hasValidGstinChecksum` in `lib/validators.ts`
(verified, not invented — a GSTIN that only *looks* right fails at the form and
wastes a run):

| Purpose | Value |
| --- | --- |
| Supplier, Maharashtra (27) | `27AAPFU0939F1ZV` |
| Client, Karnataka (29) | `29AAPFU0939F1ZR` |
| Client, Delhi (07) | `07AABCU9603R1ZP` |
| Client, Gujarat (24) | `24AAACC1206D1ZM` |
| **Invalid checksum** (negative test) | `27AAPFU0939F1ZW` |
| PAN | `AAPFU0939F` |
| IFSC | `HDFC0001234` |
| Invalid IFSC | `HDFC1234567` |

Use a fresh throwaway email per signup run (`qa+<timestamp>@example.com`).
The app sends its own verification link through Resend, and Neon Auth sends
password-reset mail through Resend SMTP, so Resend's limits apply — there is no
per-hour mailer cap to plan around. Test accounts land in the `dev` branch's own
users; reset the branch to clear them.

### Running with Playwright MCP

Point Claude Code at this file and drive it one case at a time:

> Run TC-10 from `docs/qa-test-cases.md` against http://localhost:3000 using
> Playwright MCP. Take a snapshot at each assertion and report PASS/FAIL per
> expected result.

Guidance that keeps runs deterministic:

- Prefer `browser_snapshot` over screenshots for assertions; assert on the
  accessible name, not on pixels.
- Locate fields by their **placeholder or label** (listed per case) — this app has
  few `data-testid`s.
- After any form submit, wait for the *outcome* (toast, redirect, error text), not
  a fixed timeout. The one exception is autosave, which is debounced 1500 ms
  (TC-15) and needs a real wait.
- Signed-out cases (TC-01 to TC-03) need a clean browser context — a session
  persists in cookies and silently changes what the landing page renders.

---

## Test cases

### TC-01 — Landing page, sign-up and first invoice
**Area:** Onboarding · **Priority:** P0 · **Auth:** none

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open `/` in a clean context | Hero "Invoices, done in a minute.", plus **Sign in** and **Create account** in the header |
| 2 | Click **Create your account** | Lands on `/signup` |
| 3 | Name, fresh email, 8+ char password, click **Create account** | Redirects to `/onboarding`, signed in |
| 4 | Complete both onboarding steps | Lands on `/invoices/new` with the "From" side filled in |
| 5 | Reload the page | Still signed in; the builder is not empty-stated |

**Why it matters:** there is no guest mode — Neon Auth has no anonymous users,
so every visitor signs up before seeing the builder. That makes this path the
whole activation funnel; if any step breaks, nobody reaches a first invoice.

---

### TC-02 — Signup and login form validation
**Area:** Auth · **Priority:** P0 · **Auth:** none

| Step | Action | Expected |
| --- | --- | --- |
| 1 | `/signup`, submit empty | Inline field errors; no navigation |
| 2 | Email `not-an-email`, submit | "Enter a valid email address" |
| 3 | Valid email, password `short` | "Use at least 8 characters" |
| 4 | Valid email + 8+ char password, submit | Redirects straight to `/onboarding`; a banner says the address "isn't verified yet" |
| 5 | `/login` with a known email and a wrong password | Error is shown; still on `/login`; no session cookie is set |
| 6 | `/forgot-password`, submit a valid email | Confirmation copy, no account enumeration ("no such user" must **not** be revealed) |

---

### TC-03 — Route gates for unauthenticated visitors
**Area:** Auth · **Priority:** P0 · **Auth:** none (clean context)

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Visit `/dashboard` | Redirected to `/login` |
| 2 | Visit `/invoices/new` | Redirected to `/login` |
| 3 | Visit `/settings/business` | Redirected to `/login` |
| 4 | Visit `/onboarding` | Redirected to `/login` |

**Note:** assert the final URL, not just that a login form is visible — a page
that renders login content at `/dashboard` still leaked the route.

---

### TC-04 — Un-onboarded user is forced through onboarding
**Area:** Onboarding · **Priority:** P0 · **Auth:** signed-up user with `onboarding_completed_at = null`

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Sign in, then visit `/dashboard` | Redirected to `/onboarding` |
| 2 | Try `/invoices/new` directly | Redirected to `/onboarding` |
| 3 | Complete both onboarding steps | Redirected to `/invoices/new` |
| 4 | Visit `/dashboard` again | Loads normally; no redirect loop |

**Why it matters:** the builder needs business details to exist. Landing there
without them produces an invoice with no "From" side.

---

### TC-05 — GSTIN checksum is enforced
**Area:** Validation · **Priority:** P0 · **Auth:** onboarding step 1

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Enter `27AAPFU0939F1ZW` (placeholder `27AAPFU0939F1ZV`) and submit | Rejected with "That GSTIN fails its checksum — check for a typo" |
| 2 | Enter `27AAPFU0939F1` (too short) | Rejected with the shape message ("A GSTIN is 15 characters, like 27AAPFU0939F1ZV") |
| 3 | Enter `27aapfu0939f1zv` in lower case | Accepted and upper-cased — case is not a user error |
| 4 | Enter `27AAPFU0939F1ZV` | Accepted, proceeds |

**Why it matters:** a transposed digit passes the regex but fails the checksum. A
wrong GSTIN on an issued invoice is a correction the merchant has to chase down
with their client.

---

### TC-06 — GSTIN state must agree with the selected state
**Area:** Validation · **Priority:** P0 · **Auth:** onboarding step 1

| Step | Action | Expected |
| --- | --- | --- |
| 1 | GSTIN `27AAPFU0939F1ZV` (Maharashtra) + state **Karnataka** | Rejected — the cross-field rule fires with a message naming the mismatch |
| 2 | Same GSTIN + state **Maharashtra** | Accepted |
| 3 | Turn GST registration **off**, leave GSTIN blank, pick any state | Accepted — an unregistered business needs no GSTIN |
| 4 | Turn GST registration **on**, clear the GSTIN, submit | Rejected — GSTIN becomes required |

**Why it matters:** the same rule exists as a DB `CHECK` (`businesses_gstin_matches_state`).
If the UI lets it through, the save fails at the database with a far worse error —
so a passing step 1 with a mismatch is a **P0 fail**, not a cosmetic one.

---

### TC-07 — GST registry prefill, and its fallback **[needs key]**
**Area:** Onboarding · **Priority:** P1 · **Auth:** onboarding step 1

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Enter `27AAPFU0939F1ZV` and trigger lookup | With a live Sandbox key: legal name, address and state are prefilled and the state select is consistent with the GSTIN |
| 2 | Same step, key missing/expired | A clear, non-blocking message; **all fields stay editable** and the form can be completed by hand |
| 3 | Edit a prefilled field, then submit | The edited value is what gets saved — prefill is a suggestion, not a lock |

**Known state:** the Sandbox key has expired before; the correct behaviour then is
the manual fallback in step 2, and that is a PASS. A dead end, a spinner that
never resolves, or read-only fields are FAILs.

---

### TC-08 — Bank step validation and skip
**Area:** Onboarding · **Priority:** P1 · **Auth:** onboarding step 2

| Step | Action | Expected |
| --- | --- | --- |
| 1 | IFSC `HDFC1234567` | Rejected (IFSC is 4 letters, a `0`, then 6 characters) |
| 2 | IFSC `HDFC0001234` + account name + number | Accepted |
| 3 | Fresh run: **skip** the step | Onboarding completes; lands on `/invoices/new` |
| 4 | After skipping, open `/settings/business` | Bank fields are empty and editable — nothing was silently invented |

---

### TC-09 — Onboarding resumes where it was left
**Area:** Onboarding · **Priority:** P1 · **Auth:** signed-up user mid-wizard

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Complete step 1, land on step 2 | Step 2 is shown |
| 2 | Close the tab, reopen `/onboarding` | Resumes at **step 2**, not step 1 |
| 3 | Confirm step 1 data | The business details entered in step 1 are still saved |

**Why it matters:** `profiles.onboarding_step` is kept server-side precisely so
closing the tab mid-signup loses nothing. A resume at step 1 means the state is
living in the client.

---

### TC-10 — Intra-state supply splits into CGST + SGST
**Area:** GST engine · **Priority:** P0 · **Auth:** onboarded, GST-registered, state 27

| Step | Action | Expected |
| --- | --- | --- |
| 1 | New invoice, client name + GSTIN `27AAPFU0939F1ZV`, place of supply **Maharashtra (27)** | — |
| 2 | One line: qty `1`, rate `10000`, GST `18%` | — |
| 3 | Read the totals panel | `Taxable value ₹10,000.00`, `CGST ₹900.00`, `SGST ₹900.00`, **no IGST row**, `Total ₹11,800.00` |
| 4 | Read the document heading | "Tax Invoice" |
| 5 | Read the rate-wise tax breakup | One row at 18% whose CGST + SGST equals the total tax exactly |

**Why it matters:** CGST is rounded and SGST is *derived by subtraction*, so the
two halves must always sum to the total tax even at an odd number of paise.

---

### TC-11 — Inter-state supply charges a single IGST
**Area:** GST engine · **Priority:** P0 · **Auth:** as TC-10

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Client GSTIN `29AAPFU0939F1ZR`, place of supply **Karnataka (29)** | — |
| 2 | One line: qty `1`, rate `10000`, GST `18%` | `IGST ₹1,800.00`; **no CGST/SGST rows**; `Total ₹11,800.00` |
| 3 | Switch place of supply back to **27** without touching the line | Totals recompute live to CGST/SGST — the treatment follows place of supply, not the client record |
| 4 | Save the draft, reload the page | The persisted totals match what was displayed |

---

### TC-12 — Unregistered supplier issues a Bill of Supply
**Area:** GST engine · **Priority:** P0 · **Auth:** onboarded with GST registration **off**

| Step | Action | Expected |
| --- | --- | --- |
| 1 | New invoice, one line: qty `1`, rate `10000`, any GST rate | — |
| 2 | Read the document heading | "Bill of Supply" (not "Tax Invoice") |
| 3 | Read the totals | No CGST/SGST/IGST rows at all; `Total ₹10,000.00` |
| 4 | Read the footer note | Explains the supplier is not registered under GST and no tax is charged |

**Why it matters:** registration is checked *before* geography — an unregistered
supplier cannot charge tax regardless of where the client is.

---

### TC-13 — Export is zero-rated, and reverse charge collects nothing
**Area:** GST engine · **Priority:** P1 · **Auth:** onboarded, GST-registered

| Step | Action | Expected |
| --- | --- | --- |
| 1 | New invoice with a taxable line, then toggle **Export** on | Tax rows disappear; total equals the taxable value; document notes "Export — zero rated" |
| 2 | With Export on, set place of supply to a domestic state | Still zero-rated — export wins over the state comparison and must not become IGST |
| 3 | Fresh invoice, Export off, toggle **Reverse charge** on | No tax collected, but the taxable value still shows, plus the Section 9(3)/9(4) note |
| 4 | Toggle both back off | Tax returns to the TC-10/TC-11 behaviour |

---

### TC-14 — Discounts, fractional quantities, round-off and amount in words
**Area:** GST engine · **Priority:** P0 · **Auth:** onboarded, GST-registered, state 27

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Line: qty `2.5`, rate `1000`, GST `18%`, intra-state | Gross `₹2,500.00`; tax `₹450.00` split `₹225.00` / `₹225.00`; total `₹2,950.00` |
| 2 | Add `10%` discount to that line | Discount `₹250.00`; taxable `₹2,250.00`; tax `₹405.00`; total `₹2,655.00` |
| 3 | Line: qty `3`, rate `33.33`, GST `18%` | A **Round off** row appears and the grand total is a whole rupee |
| 4 | Read the amount in words | Matches the grand total, in Indian numbering, ending in "only" |
| 5 | Enter a discount of `150` (over 100) | Clamped to 100% — never a negative taxable value |

**Why it matters:** everything is computed in integer paise. A float creeping in
shows up here first, as a total that is off by a paisa.

---

### TC-15 — Autosave
**Area:** Invoice builder · **Priority:** P0 · **Auth:** onboarded

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open `/invoices/new`, type a client name only | **No** autosave — an invoice with no line item is not worth saving |
| 2 | Add one line item with a rate; wait ~2 s (debounce is 1500 ms) | "Saved <time>" indicator appears; the URL replaces to `/invoices/<id>/edit` |
| 3 | Press **Back** | Does **not** return to a blank `/new` (the redirect used `replace`) |
| 4 | Change the rate, wait ~2 s, reload | The changed rate persisted |
| 5 | Go offline, change a field, wait | The failure is **announced** (toast), not swallowed |
| 6 | Click **Save draft** with no client | Button is disabled |

---

### TC-16 — AI: a sentence becomes a populated draft **[needs key]**
**Area:** AI · **Priority:** P0 · **Auth:** onboarded

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open the AI panel (textarea labelled "Describe the invoice with AI") | Placeholder reads `Invoice Sharma Traders ₹45,000 for design work` |
| 2 | Enter `Invoice Sharma Traders 45000 for brand identity design, 18% GST, due in 15 days` and submit | Client name, a line item at ₹45,000, GST 18% and a due date ~15 days out are filled into the **form** |
| 3 | Inspect the network call | `POST /api/ai/parse-invoice` returns a `draft` only — **no invoice row is created by the request** |
| 4 | Wait ~2 s after the fill | Normal autosave takes over and saves the draft (the AI fill marks fields dirty) |
| 5 | Correct a wrong amount by hand, then save | The corrected value wins |
| 6 | Submit the same sentence twice | Substantially the same draft both times (temperature is 0) |

**Why it matters:** the AI populates fields for review and never writes to the
database itself, so a misheard amount cannot commit itself.

---

### TC-17 — AI failure modes
**Area:** AI · **Priority:** P1 · **Auth:** onboarded

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Open the AI panel with an empty textarea | Submit is disabled; if forced, the API answers `400` "Say or type what you want to bill for." |
| 2 | Paste >2000 characters and submit | `400` "That instruction is too long." — a readable error, not a spinner |
| 3 | Run with `OPENAI_API_KEY` unset | `503` "AI invoicing is not configured yet." and the manual form remains fully usable |
| 4 | Send gibberish (`asdfgh qwerty`) | Either an empty/minimal draft or `502` "Could not turn that into an invoice. Try rephrasing it." — never a half-filled invoice with invented amounts |
| 5 | Deny microphone permission, click the mic | "Microphone permission was denied."; the text path still works |
| 6 | Close the panel mid-request ("Close AI panel") | No stray toast or crash afterwards |

**Playwright note:** grant/deny mic via context permissions; `MediaRecorder`
support gates the mic button, so assert it is simply absent where unsupported
rather than expecting a click to work.

---

### TC-18 — Send: the number is claimed once, and the invoice freezes
**Area:** Invoicing · **Priority:** P0 · **Auth:** onboarded, with a saved draft

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Look at the draft on `/dashboard` | Status **Draft**, and the Number column is **empty** — no number is assigned to a draft |
| 2 | Send the invoice | Dialog "Your invoice is ready to share" with a share link; status becomes **Sent**; a number like `INV-1` now exists |
| 3 | Send the same invoice again | The number is **unchanged** (re-send is idempotent) and no gap is punched in the series |
| 4 | Create and send a second invoice | It gets the **next** number, with no gaps and no reuse |
| 5 | Reopen the sent invoice's edit page and try to change a line item | Editing is refused / **Save draft** is unavailable — the document is frozen |
| 6 | Send an invoice with **no** line items | Refused: "Add at least one line item before sending." |
| 7 | With `RESEND_API_KEY` set, send with email on to a real inbox | The email arrives with the PDF attached |

**Why it matters:** gaps in a GST invoice series are exactly what an audit asks
about, and a sent invoice whose line items changed underneath its frozen header is
a document that no longer adds up. Both are **P0**.

---

### TC-19 — Public share link and PDF
**Area:** Sharing · **Priority:** P0 · **Auth:** none for the link itself

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Copy the share link from the send dialog ("Copy link"), open it in a **clean context** | The invoice renders: number, supplier name, total, due date, status badge |
| 2 | Check the page metadata | `robots: noindex, nofollow` — a forwarded invoice must not get indexed |
| 3 | Click **Download** | A PDF downloads whose totals match the page exactly |
| 4 | Open `/i/definitely-not-a-real-token` | **404** |
| 5 | Get the token of a **draft** invoice and open it | **404** — a draft is not publicly viewable |
| 6 | Cancel an invoice, then open its token | **404**, and indistinguishable from cases 4 and 5 |
| 7 | Owner opens `/api/invoices/<id>/pdf` for **another** user's invoice | Not found / not authorised — never another tenant's PDF |

**Why it matters:** a bad token, a draft and a cancelled invoice all 404 on
purpose, so a visitor learns nothing about which. Step 7 is the RLS check — a
success there is a data breach, not a bug.

---

### TC-20 — Mark paid, derived overdue, and dashboard totals
**Area:** Dashboard · **Priority:** P0 · **Auth:** onboarded, with sent invoices

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Sent invoice with due date **yesterday** | Shows **Overdue** on the dashboard and on the public link |
| 2 | Sent invoice with due date **today** | Shows **Sent**, *not* overdue — it is not overdue during its due date |
| 3 | Sent invoice with **no** due date | Shows **Sent**; the public page reads "due on receipt" |
| 4 | Mark the overdue invoice as **paid** — see the gap note below | Status becomes **Paid**, with no memory of the lateness |
| 5 | Reload the dashboard | Paid persists; the paid total reflects it |
| 6 | Try to mark a **draft** as paid | Refused — only an issued invoice can be paid |
| 7 | Empty account | Empty state offers "Raise your first invoice" |

> **Known gap (found while writing these cases):** `markPaidAction` exists in
> `lib/actions/send.ts` but is **not wired to any UI control**. Until it is,
> steps 4-6 cannot be run from the browser — flip `invoices.status` with SQL on
> the Neon `dev` branch (Neon console SQL editor, or `psql` with
> `DATABASE_URL_UNPOOLED` from `.env.local`) to verify the display side (steps 1-3, 5, 7), and log steps 4 and 6 as
> BLOCKED-by-product, not as failures.

**Why it matters:** overdue is derived at display time, never stored, so it is
correct without a scheduler. If step 2 shows Overdue, the comparison has slipped
from whole dates to timestamps.

---

## Reporting

Per case, record: **PASS / FAIL / BLOCKED**, the branch taken for `[needs key]`
cases, and for a FAIL — the step number, the accessibility snapshot, and the
console/network error. Anything in **TC-05, TC-06, TC-10, TC-11, TC-12, TC-18,
TC-19** blocks release: those are the tax-correctness, numbering and
tenant-isolation invariants.

## Not covered here

Deliberately out of scope, and why:

- **Pure calculation edge cases** — already unit-tested in `lib/gst.test.ts`,
  `lib/validators.test.ts`, `lib/invoice-status.test.ts`, `lib/pdf.test.tsx`
  (`pnpm test`). Browser runs are slow; don't spend them re-testing arithmetic.
- **Password reset via a live email link** — needs a real inbox (Neon Auth sends
  it through Resend SMTP); run it out-of-band.
- **Multi-currency and cess** — schema supports them, the UI does not surface them
  yet.
