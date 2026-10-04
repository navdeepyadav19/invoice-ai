# QA Test Cases — Invoice-AI

Twenty scenarios QA runs before every release. A person runs them by hand in a
real browser; the steps that check the API or a server response can also be run
with `curl` (see "Running the cases" below). Seven cases cover features that have
since been removed and are kept, marked **Retired**, so old run reports still
make sense.

Coverage is deliberately weighted towards the app's *invariants* rather than its
happy paths, because that is where this product breaks in ways a customer would
have to explain to their accountant:

- tax follows from the line items, never from what the client posted;
- an invoice number is claimed once, on issue, and never re-used;
- an issued invoice is frozen;
- one tenant never sees another's data.

---

## Before you start

### Environment

| Item | Value |
| --- | --- |
| Base URL | `http://localhost:3000` (`pnpm dev`) |
| Required env | `DATABASE_URL`, `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET`, `NEXT_PUBLIC_SITE_URL` |
| Optional env | `OPENAI_API_KEY` (TC-16/17), `RESEND_API_KEY` + `INVOICE_FROM_EMAIL` (TC-18 email), `API_KEY_PEPPER` (curl checks against `/api/v1`) |
| Database | `.env.local` points at the Neon **`dev`** branch, never production (`main`) — see `docs/neon-overview.md` |
| Neon Auth trusted domains | `localhost` is allowed by default; any other origin you test from (a preview URL, a LAN IP) must be added to Neon Auth's trusted domains |

Cases marked **[needs key]** degrade to an assertion about the *fallback* path when
the key is absent — that is a valid run, not a skip. Record which branch you took.

### Test data

Onboard the test business in **United States / USD** unless a case says
otherwise, so the expected amounts below read as written. The tax ID is optional
free text and the bank fields have no format check, so any values work; the
placeholders (`111000025` for the routing number) are fine.

The GSTIN, PAN and IFSC test data that used to live here went with the India-only
validation (commit `dc3eaac`, 2026-09-20).

Use a fresh throwaway email per signup run (`qa+<timestamp>@example.com`).
The app sends its own verification link through Resend, and Neon Auth sends
password-reset mail through Resend SMTP, so Resend's limits apply — there is no
per-hour mailer cap to plan around. Test accounts land in the `dev` branch's own
users; reset the branch to clear them.

### Running the cases

Run one case at a time in a normal browser window, top to bottom, and record the
result per step.

- Signed-out cases (TC-01 to TC-03) need a clean session: a private window, or
  sign out first. A session persists in cookies and silently changes what the
  landing page renders.
- After any form submit, wait for the *outcome* (toast, redirect, error text).
  Autosave is debounced 1500 ms (TC-15), so give it a couple of seconds.
- Use the browser's DevTools Network tab where a case asks you to inspect a
  request (TC-16, TC-17).
- Agents helping with a run don't drive the browser. They can run the `curl`
  checks below and read logs; the clicking is done by a person.

Some checks don't need a browser at all. Mint an API key for the test user (it
needs `DATABASE_URL_UNPOOLED` and `API_KEY_PEPPER` in `.env.local`):

```bash
pnpm api:key qa+<timestamp>@example.com     # prints the key once
export KEY=inv_live_...
BASE=http://localhost:3000
```

```bash
# TC-03: protected pages redirect to /login (expect 307 and a /login location)
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' $BASE/dashboard

# TC-19 step 4: an unknown share token is a 404
curl -s -o /dev/null -w '%{http_code}\n' $BASE/i/definitely-not-a-real-token

# TC-20 steps 4 and 6: mark an invoice paid (ids are in_…, from GET /api/v1/invoices)
curl -s $BASE/api/v1/invoices -H "Authorization: Bearer $KEY"
curl -s -X POST $BASE/api/v1/invoices/in_.../pay \
  -H "Authorization: Bearer $KEY" -H "Idempotency-Key: $(uuidgen)" \
  -H 'Content-Type: application/json' -d '{}'
```

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

> **Retired (2026-09-20):** GSTIN validation was removed when the app went worldwide (`dc3eaac`); the tax ID is free text. Kept for old run reports; skip it.

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

> **Retired (2026-09-20):** GST registration, state and the `businesses_gstin_matches_state` check were removed (`dc3eaac`, migration `0009`). Kept for old run reports; skip it.

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

> **Retired (2026-09-20):** The Sandbox GSTIN lookup and its `SANDBOX_API_*` keys were removed (`dc3eaac`). Kept for old run reports; skip it.

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
| 1 | Routing number `111000025` + account name + number | Accepted (no IFSC-style format check since `dc3eaac`; any value is stored as typed) |
| 2 | Leave a field blank and continue | Accepted — every bank field is optional |
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

> **Retired (2026-09-20):** The GST engine was replaced by one exclusive rate per line in `lib/tax.ts` (`dc3eaac`); there is no CGST/SGST. Kept for old run reports; skip it.

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

> **Retired (2026-09-20):** No IGST or place of supply since the generic tax engine (`dc3eaac`). Kept for old run reports; skip it.

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Client GSTIN `29AAPFU0939F1ZR`, place of supply **Karnataka (29)** | — |
| 2 | One line: qty `1`, rate `10000`, GST `18%` | `IGST ₹1,800.00`; **no CGST/SGST rows**; `Total ₹11,800.00` |
| 3 | Switch place of supply back to **27** without touching the line | Totals recompute live to CGST/SGST — the treatment follows place of supply, not the client record |
| 4 | Save the draft, reload the page | The persisted totals match what was displayed |

---

### TC-12 — Unregistered supplier issues a Bill of Supply
**Area:** GST engine · **Priority:** P0 · **Auth:** onboarded with GST registration **off**

> **Retired (2026-09-20):** GST registration and the "Bill of Supply" heading were removed (`dc3eaac`). Kept for old run reports; skip it.

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

> **Retired (2026-09-20):** Export and reverse-charge toggles were removed with the GST engine (`dc3eaac`). Kept for old run reports; skip it.

| Step | Action | Expected |
| --- | --- | --- |
| 1 | New invoice with a taxable line, then toggle **Export** on | Tax rows disappear; total equals the taxable value; document notes "Export — zero rated" |
| 2 | With Export on, set place of supply to a domestic state | Still zero-rated — export wins over the state comparison and must not become IGST |
| 3 | Fresh invoice, Export off, toggle **Reverse charge** on | No tax collected, but the taxable value still shows, plus the Section 9(3)/9(4) note |
| 4 | Toggle both back off | Tax returns to the TC-10/TC-11 behaviour |

---

### TC-14 — Discounts, fractional quantities, rounding and amount in words
**Area:** Tax engine · **Priority:** P0 · **Auth:** onboarded, currency USD

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Line: qty `2.5`, rate `1000`, tax `18%` | Gross `$2,500.00`; tax `$450.00`; total `$2,950.00` |
| 2 | Add `10%` discount to that line | Discount `$250.00`; taxable `$2,250.00`; tax `$405.00`; total `$2,655.00` |
| 3 | Fresh invoice, line: qty `3`, rate `33.33`, tax `18%` | Subtotal `$99.99`; tax `$18.00` (17.9982 rounded to the cent); total `$117.99`. No "Round off" row — that was GST-only |
| 4 | Read the amount in words for step 2 | "Two Thousand Six Hundred Fifty USD Only" — it matches the grand total |
| 5 | Enter a discount of `150` (over 100) | Clamped to 100% — never a negative taxable value |

**Why it matters:** everything is computed in integer minor units (cents here). A
float creeping in shows up here first, as a total that is off by a cent.

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
| 1 | Open the AI panel (textarea labelled "Describe the invoice with AI") | Placeholder reads `Invoice Acme $45,000 for design work` |
| 2 | Enter `Invoice Acme 45000 for brand identity design, 18% tax, due in 15 days` and submit | Client name, a line item at $45,000, tax 18% and a due date ~15 days out are filled into the **form** after you confirm the summary ("Fill this in") |
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

**Browser note:** deny the mic from the address bar's site settings, then reload.
`MediaRecorder` support gates the mic button, so where it is unsupported the button
is simply absent — that is a pass, not a failure to click.

---

### TC-18 — Issue: the number is claimed once, and the invoice freezes
**Area:** Invoicing · **Priority:** P0 · **Auth:** onboarded, with a saved draft

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Look at the draft on `/dashboard` | Status **Draft**, and the Number column is **empty** — no number is assigned to a draft |
| 2 | Click **Issue invoice** in the builder | Dialog "Your invoice is ready to share" with a share link; status becomes **Open**; a number like `INV-0001` now exists |
| 3 | Click **Get link** on the same invoice | The number is **unchanged** (issuing is idempotent) and no gap is punched in the series |
| 4 | Create and issue a second invoice | It gets the **next** number, with no gaps and no reuse |
| 5 | Reopen the issued invoice's edit page and try to change a line item | Editing is refused / **Save draft** is unavailable — the document is frozen |
| 6 | Issue an invoice with **no** line items (via the API: `POST /api/v1/invoices/{id}/finalize` on an empty draft) | Refused: "Add at least one line item before sending." |
| 7 | With `RESEND_API_KEY` set, click **Email it** for a client with a real inbox | The email arrives with the PDF attached |

**Why it matters:** gaps in an invoice series are exactly what an audit asks
about, and an issued invoice whose line items changed underneath its frozen header
is a document that no longer adds up. Both are **P0**.

---

### TC-19 — Public share link and PDF
**Area:** Sharing · **Priority:** P0 · **Auth:** none for the link itself

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Copy the share link from the issue dialog ("Copy link"), open it in a **private window** | The invoice renders: number, supplier name, total, due date, status badge |
| 2 | Check the page metadata | `robots: noindex, nofollow` — a forwarded invoice must not get indexed |
| 3 | Click **Download PDF** | A PDF downloads whose totals match the page exactly |
| 4 | Open `/i/definitely-not-a-real-token` | **404** |
| 5 | Get the token of a **draft** invoice and open it | **404** — a draft is not publicly viewable |
| 6 | Void an invoice (API only — `POST /api/v1/invoices/{id}/void` with `{"reason":"qa"}` and an `Idempotency-Key`), then open its token | **404**, and indistinguishable from cases 4 and 5 |
| 7 | Owner opens `/api/invoices/<id>/pdf` for **another** user's invoice | Not found / not authorised — never another tenant's PDF |

**Why it matters:** a bad token, a draft and a cancelled invoice all 404 on
purpose, so a visitor learns nothing about which (`get_public_invoice` excludes
`draft` and `void`). Step 7 is the RLS check — a
success there is a data breach, not a bug.

---

### TC-20 — Mark paid, derived overdue, and dashboard totals
**Area:** Dashboard · **Priority:** P0 · **Auth:** onboarded, with issued invoices

| Step | Action | Expected |
| --- | --- | --- |
| 1 | Issued invoice with due date **yesterday** | Shows **Overdue** on the dashboard and on the public link |
| 2 | Issued invoice with due date **today** | Shows **Open**, *not* overdue — it is not overdue during its due date |
| 3 | Issued invoice with **no** due date | Shows **Open**; the public page reads "due on receipt" |
| 4 | Mark the overdue invoice as **paid** — via the API, see the gap note below | Status becomes **Paid**, with no memory of the lateness |
| 5 | Reload the dashboard | Paid persists; the paid total reflects it |
| 6 | Try to mark a **draft** as paid (API) | Refused with `409` — only an issued invoice can be paid |
| 7 | Empty account | Empty state offers "Raise your first invoice" |

> **Known gap:** `payAction` exists in `lib/actions/send.ts` but is **not wired
> to any UI control**. Run steps 4 and 6 with `POST /api/v1/invoices/{id}/pay`
> (the curl block under "Running the cases"), then check the display side in the
> browser. If you can't mint an API key, log steps 4 and 6 as BLOCKED-by-product,
> not as failures.

**Why it matters:** overdue is derived at display time, never stored, so it is
correct without a scheduler. If step 2 shows Overdue, the comparison has slipped
from whole dates to timestamps.

---

## Reporting

Per case, record: **PASS / FAIL / BLOCKED**, the branch taken for `[needs key]`
cases, and for a FAIL — the step number, a screenshot, and the console/network
error. Anything in **TC-03, TC-14, TC-18, TC-19** blocks release: those are the
route-gate, tax-correctness, numbering and tenant-isolation invariants. Retired
cases are recorded as RETIRED.

## Not covered here

Deliberately out of scope, and why:

- **Pure calculation edge cases** — already unit-tested in `lib/tax.test.ts`,
  `lib/money.test.ts`, `lib/currency.test.ts`, `lib/validators.test.ts`,
  `lib/invoice-status.test.ts`, `lib/pdf.test.tsx`
  (`pnpm test`). Browser runs are slow; don't spend them re-testing arithmetic.
- **Password reset via a live email link** — needs a real inbox (Neon Auth sends
  it through Resend SMTP); run it out-of-band.
- **Other currencies** — the builder has a per-invoice currency override, and
  zero-decimal currencies (JPY) round to whole units. That is covered by
  `lib/tax.test.ts` and `lib/currency.test.ts`; spot-check one non-USD invoice by
  hand if the release touched money formatting.
