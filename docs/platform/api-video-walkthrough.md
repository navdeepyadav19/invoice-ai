# API walkthrough: talk track for the video

> **Length:** about 8–10 minutes of code tour, then Postman.
> **Audience:** technical students who have seen the web app.
> **Story in one line:** *We didn't bolt an API onto the app. First we pulled the business rules out into a shared layer, then we put one pipeline in front of them, and each endpoint turned out to be about ten lines.*

Open each file in Claude Code as you reach its stop. The **Say** lines are the talking points; the **Show** lines are what should be on screen.

---

## Stop 0 · The big picture (1 min)

**Say:** "An API request passes through four layers. Every endpoint uses the same four, so once you know them you can read any endpoint."

```
Postman / SDK / CLI / MCP
        │   Authorization: Bearer inv_live_…
        ▼
app/api/v1/**/route.ts      ← endpoints (thin: parse → call service → serialize)
        ▼
lib/api/handler.ts          ← withApi(): the one pipeline every endpoint runs
        ▼
lib/services/*.ts           ← business rules, shared with the web UI
        ▼
Neon Postgres + RLS         ← tenant isolation enforced by the database
```

---

## Stop 1 · The foundation: a service layer (2 min)

**Say:** "Before this, all the logic lived in server actions under `lib/actions/`. Those are tied to the browser. They read cookies, they redirect to `/login`, they take `FormData`. An API can't reuse any of that. So step zero was moving the logic into plain functions that get told *who is calling* as an argument, instead of looking it up."

**Show:**
- `lib/auth/context.ts`: the `AuthContext` type. Point at `via: 'session' | 'api_key' | 'oauth'`. "The same function serves a browser, an API key, or an AI agent. Only the context changes."
- `lib/services/clients.ts` → `create()` (line ~78). Three lines carry the idea:
  - `requireScope(ctx, 'clients:write')`: the service checks permission itself.
  - `clientSchema.safeParse(input)`: validation lives here, not in the route.
  - `ctx.db.insertInto('clients').values(...)`: this Kysely handle is *already scoped to the user* (every statement runs as `authenticated` with `app.uid()` set to them), so RLS does the tenant filtering. "You'll never see `.where('owner_id', …)` in a service."
- `lib/services/errors.ts`: services throw one `ServiceError` with a code (`validation`, `not_found`, `invalid_state`…), not HTTP errors. HTTP comes later.

**Say:** "The web UI's server actions now call these same services. That's why the API and the app can't drift apart: there's only one copy of the rules."

---

## Stop 2 · The database foundation (1 min)

**Show:** `db/migrations/` (applied with `pnpm db:migrate`)

| Migration | What it adds for the API |
|---|---|
| `0004_foundation.sql` | Atomic `issue_invoice()`, so an invoice number can never be burned twice |
| `0005_api_keys.sql` | `api_keys` table (stores a hash, never the key) + `api_key_by_prefix()` lookup |
| `0006_api_runtime.sql` | `idempotency_keys` + `api_requests` (the audit log) |
| `0007_webhooks.sql` | Webhook endpoints and deliveries |
| `0009`–`0011` | Stripe-shaped IDs, products, prices, invoice items |

**Say:** "Every table has row-level security: `owner_id = (select app.uid())`. That rule is the real security boundary. Everything in the app layer sits on top of it."

---

## Stop 3 · Identity: how an API key becomes a user (1.5 min)

**Show:** `lib/auth/api-key.ts`. Read the key-format diagram at the top out loud: `inv_live_` marker, 8-char public prefix, 32-char secret that is only ever stored as an HMAC.

**Show:** `lib/api/authenticate.ts`, following the steps in order:
1. Read `Authorization: Bearer inv_live_…`
2. Look up the row by prefix, compare the hashed secret
3. Check not revoked or expired, parse scopes
4. `userDb(row.owner_id)` from `lib/db`: a connection that runs as that user

**Say (key teaching moment):** "The shortcut would be to use the owner connection, `systemDb()`, once the API key checks out. That bypasses RLS, and then one forgotten filter leaks another customer's data. It's so dangerous that an ESLint rule lets only the webhook cron import it. Instead the API key resolves to its **owner**, and every statement runs as that user: `SET LOCAL ROLE authenticated` plus `app.uid()` set to the owner, inside one transaction (`lib/db/scoped.ts`). Postgres then applies the exact same policies it applies to the browser."

**Show:** `lib/auth/scopes.ts`. "`invoices:write` can edit drafts but *can't* finalize. Assigning a legal invoice number is its own scope, and so is emailing a client."

---

## Stop 4 · The pipeline: `withApi()` (2 min)

**Show:** `lib/api/handler.ts`. The comment block at the top is the whole lesson:

```
1. request id    → 2. authenticate → 3. rate limit → 4. scope check
→ 5. idempotency → 6. handler      → 7. map errors → 8. audit (after response)
```

**Say:** "Every one of these is something a developer would forget in exactly one endpoint, and that's the endpoint that causes the incident. So none of it lives in the endpoints."

Then briefly show the helpers it uses, one sentence each:

| File | One-liner |
|---|---|
| `lib/api/rate-limit.ts` | 120 requests/min per key, 10 sends/hour. Sets `RateLimit-*` headers |
| `lib/api/idempotency.ts` | The table in its header comment: first call runs, retry replays, different body → 422 |
| `lib/api/problem.ts` | One error shape (RFC 9457 `problem+json`). Maps `ServiceError` codes to HTTP status |
| `lib/api/validate.ts` | `parseWire()` turns a bad payload into a field-level 422 |
| `lib/api/serialize.ts` | DB row → public JSON: Stripe-style IDs (`cus_…`, `in_…`), money in integer minor units |

Also mention `proxy.ts` at the repo root: `/api/v1/` is exempt from the login redirect. "Without that, a valid API key would get a 307 to an HTML login page."

---

## Stop 5 · Where the endpoints live (1.5 min)

**Show:** the folder tree. In Next.js the file path *is* the URL.

```
app/api/v1/
├── business/route.ts                 GET
├── customers/route.ts                GET list, POST create
├── customers/[id]/route.ts           GET, PATCH, DELETE
├── products/ …  prices/ …            same pattern
├── invoices/route.ts                 GET list, POST draft
├── invoices/[id]/route.ts            GET, PATCH, DELETE (drafts)
├── invoices/[id]/finalize|send|pay|void/route.ts   actions
├── invoices/[id]/pdf|events/route.ts               PDF + history
├── invoice-items/ …                  lines on a draft
├── webhook-endpoints/ …              register / list / delete
└── openapi.json/route.ts             the contract, no auth
```

**Show:** `app/api/v1/customers/route.ts`. "This is a whole endpoint. Declare the scope, parse, call the service, serialize. No auth code, no try/catch, no SQL."

**Show:** `app/api/v1/invoices/[id]/finalize/route.ts`. "Same shape, one option changed: `idempotent: 'required'`. Finalizing burns an invoice number, so we refuse the call without an `Idempotency-Key`. And the database function checks again. Belt and braces." Then run `grep -rn "idempotent: 'required'" app/api/v1` on screen: create invoice, add line, finalize, send, pay, void. "It's every call that spends a number, sends an email, or records money."

---

## Stop 6 · One source of truth for the contract (30 s)

```
lib/validators.ts (zod) ──► runtime validation
          └──► lib/api/openapi.ts ──► GET /api/v1/openapi.json
                                   └► pnpm postman:gen ──► docs/platform/postman/
```

**Say:** "The same zod schemas validate requests *and* generate the docs and the Postman collection. The docs can't drift from the code, because they come from the code."

---

## Handoff to Postman

**Setup on camera:**
1. App → **Settings → API keys** → create a key, tick the scopes. "Shown once. We only store a hash."
2. Postman → import `docs/platform/postman/invoice-ai.postman_collection.json` and `invoice-ai.postman_environment.json`.
3. Set `base_url` and `api_key` in the environment. The collection fills `customer_id`, `invoice_id`, and the other IDs as you go.

**Suggested order (it tells a story):**

| # | Request | What to point out |
|---|---|---|
| 1 | Business → Read the business profile | Simplest call. Show `x-request-id` and `ratelimit-remaining` headers |
| 2 | Customers → Create, then List | `cus_…` ID, `{ data, next_cursor }` envelope |
| 3 | Products → Create, Prices → Create | `unit_amount` in minor units (250000 = 2,500.00) |
| 4 | Invoices → Create a draft | Status `draft`, no number yet |
| 5 | Invoices → Finalize a draft | Gets a permanent number. For the replay demo, replace `{{idempotency_key}}` in the header with a fixed value like `demo-1` first (the collection makes a fresh UUID on every send). Send twice → second response has `Idempotent-Replayed: true` and the same number |
| 6 | Email / Mark paid / PDF / Invoice history | The lifecycle. History shows every event |
| 7 | Webhooks → Register | Events get pushed to your server |

**Failure demos (these teach the most):**
- Remove the `Authorization` header → **401** `problem+json` with a helpful `detail`
- Finalize with no `Idempotency-Key` → **428**
- Create a customer with an empty body → **422** with a field-level `errors[]`
- Delete a draft that's already been finalized → **409** `invalid_state` (a numbered invoice can only be voided)
- Read a random ID → **404** (never 403, so nobody can probe which IDs exist)

**Closing line:** "Everything you just hit in Postman is the same service layer the web app uses. Next module we'll wrap these endpoints in an SDK, and you'll see it takes almost no new code."
