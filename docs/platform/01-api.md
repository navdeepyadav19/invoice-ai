# 01 · REST API v1

> **Depends on:** [00-foundation.md](00-foundation.md). Every endpoint here is a thin wrapper around a service function.
> **Needed by:** [02-sdk.md](02-sdk.md), [03-cli.md](03-cli.md), [04-mcp.md](04-mcp.md).
>
> **Backend note:** this module was planned on Supabase, where an API key was exchanged for a short-lived JWT so PostgREST would apply RLS. Since the move to **Neon** there is no JWT and no PostgREST: the key resolves to an owner id and the request gets a database handle scoped to that owner. Section 3.2 describes the mechanism as it works now; see also [../neon-overview.md](../neon-overview.md).
>
> **Status (Oct 2026):** phases A1–A3 are built; A4 (OAuth) is not. The shipped API went **Stripe-shaped** (`0011_stripe_api.sql`) and **worldwide** (`0009_global_breaking.sql`), so the names below differ from this plan: `customers` not `clients`, `finalize` / `pay` / `void` not `issue` / `mark-paid` / `cancel`, scope `invoices:finalize` not `invoices:issue`, statuses `draft` / `open` / `paid` / `void`, amounts in integer minor units of the invoice currency. Sections 3.4, 3.5, 3.7 and 3.9 are updated to what shipped. The live contract is `GET /api/v1/openapi.json`; [api-getting-started.md](api-getting-started.md) is the user-facing guide.

## 1. What this layer is, and what students learn

An API is a **contract**: "send me this shape, and I promise to answer with that shape". Once other people build on it, you can't change it casually.

Students leave this module understanding four ideas:

1. **Identity comes in two kinds.**
   - An **API key** is like a building access card: whoever holds it gets in, and it identifies *a credential*.
   - **OAuth** is like a guest list the owner signed: it says *which user* approved *which app* to do *what*.
2. **Scopes** limit what a credential can do, even when it's valid.
3. **Idempotency.** A network retry must never spend a second invoice number.
4. **Webhooks.** The API also *calls you* when something happens, and signs the request so you can trust it.

## 2. How it works in this repo today

- **There is no public API.** The only route handlers are:
  - `app/api/ai/parse-invoice/route.ts`, `app/api/ai/transcribe/route.ts` (OpenAI)
  - `app/api/invoices/[id]/pdf/route.ts` (the owner's PDF)
  - `app/api/public/[token]/pdf/route.ts` (public share-link PDF)
  - `app/auth/callback/route.ts`
- **Authentication is cookie-only.** The signed-in user comes from the browser's session cookie, and nothing reads an `Authorization` header.
- **`proxy.ts` redirects every non-public path to `/login`.** A program calling `/api/v1/invoices` with a bearer token would get an HTML redirect, not a `401`.
- **Tenant isolation is RLS** (`owner_id = app.uid()`) on every table in `db/migrations/0001_init.sql`. This is good: the API design below keeps RLS as the guard instead of replacing it.

**Show the students:** run `curl -i https://<site>/api/invoices/<id>/pdf` without a cookie. You get a redirect to `/login`, which is fine for browsers and useless for programs.

## 3. Design

### 3.1 The request pipeline

Every route under `app/api/v1/**/route.ts` (new) is wrapped by one helper, `lib/api/handler.ts#withApi` (new):

```ts
// app/api/v1/invoices/[id]/finalize/route.ts, shape only
export const POST = withApi(
  { scope: 'invoices:finalize', idempotent: 'required' },
  async (ctx, req, { params }) => invoices.finalize(ctx, (await params).id),
)
```

`withApi` runs the same steps, in the same order, for every request:

```
1. request id      read X-Request-Id or generate one, echo it back
2. authenticate    API key ─► owner id ─► userDb(owner)   |   OAuth token ─► verify + grant lookup
3. rate limit      per credential quota → 429 + Retry-After
4. scope check     ctx.scopes must include the route's scope → 403
5. idempotency     claim Idempotency-Key (writes only) → replay / 409 / 422
6. validate        zod parse of params, query, body → 422 problem+json
7. call service    lib/services/* with the AuthContext
8. map errors      ServiceError → problem+json status
9. audit           write one api_requests row
```

`proxy.ts` must **exempt** `/api/v1/`, `/api/mcp` and `/.well-known/` from the login redirect. (It does, for `/api/v1/`, `/api/cli/`, `/api/cron/` and `/.well-known/`.)

### 3.2 API keys (built first)

| Decision | Choice |
|---|---|
| Format | `inv_live_<8-char id>_<32-char base62 secret>`. The prefix makes leaked keys greppable and lets GitHub secret scanning spot them |
| Storage | Only an **HMAC-SHA256 hash** of the secret (with a server-side pepper `API_KEY_PEPPER`). The full key is shown **once** at creation |
| Where users manage them | New settings page `app/(app)/settings/api-keys/page.tsx`: create (name, scopes, optional expiry), list (prefix, last used), revoke |
| Who can create them | Any signed-in user. (On Supabase this excluded anonymous guest accounts; guest mode no longer exists) |

**New table `api_keys`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_id` | uuid (a Neon Auth user id) | RLS: `owner_id = app.uid()` |
| `name` | text | "Zapier", "My laptop" |
| `prefix` | text unique | `inv_live_ab12cd34`, used for lookup |
| `secret_hash` | text | HMAC-SHA256(pepper, secret) |
| `scopes` | text[] | subset of the scope list below |
| `created_at`, `last_used_at`, `expires_at`, `revoked_at` | timestamptz | |

#### How an API key still respects RLS (the important trick)

The tempting shortcut is to look up the key, then query the database with the **owner connection** (the role the app logs in as). That role **bypasses RLS completely**, so one missing `where owner_id = …` anywhere would leak another business's invoices.

Instead, the key only ever produces a *user id*, and the request runs as that user:

```
Authorization: Bearer inv_live_ab12cd34_…
        │
        ▼
lib/api/authenticate.ts   api_key_by_prefix(prefix), called as `anon`
                          (SECURITY DEFINER: the one table read allowed
                          before anyone is known)
        │
        ▼
lib/auth/api-key.ts       HMAC(API_KEY_PEPPER, secret) compared in constant
                          time → not revoked / not expired → scopes
        │
        ▼
lib/db/index.ts           ctx.db = userDb(row.owner_id)
        │
        ▼
lib/db/scoped.ts          every statement:
                            begin;
                            set local role authenticated;
                            select set_config('app.user_id', owner_id, true);
                            <query>;
                            commit;
        │
        ▼
Postgres sees role=authenticated, app.uid() = owner_id → the same RLS as the browser
```

A browser session takes the same last two steps: `contextFromSession()` gets the user id from Neon Auth's session cookie and calls `userDb(user.id)`. **Both doors end in the same function**, so there is no second security model to keep in sync. The existing `claim_invoice_number` and `issue_invoice` functions check `app.uid()` and are granted to `authenticated`, so they work unchanged for API calls.

There is no token to mint and no signing key to protect. There is also no public HTTP endpoint into the database (no PostgREST, Neon's Data API is off): only our server holds a connection string, so every query passes through `userDb()`, `anonDb()` or the cron's owner connection.

> **How it was on Supabase:** the key was exchanged for a 60-second ES256 JWT (`sub: owner_id`, `role: authenticated`) signed with a key imported into Supabase, and the request went through PostgREST with that token. It worked, but the private signing key could forge a session for any user. The Neon design removed that secret entirely.

**Show the students:** open `lib/db/scoped.ts` and point at `scopePrelude()`. Then, in the Neon SQL editor, run `set role authenticated; select set_config('app.user_id', '<some user id>', false); select count(*) from invoices;` and compare with the count as the owner. Same table, different answers: that is RLS.

### 3.3 OAuth for third-party apps (built second)

**Not built yet.** The original plan used Supabase Auth's built-in OAuth 2.1 server, which went away with the move to Neon. The design below still holds; what provides the authorization server is open again. Neon's managed Better Auth doesn't expose one: its plugins are organization, magic link, phone number, email/password and social login, with no OAuth-provider or OIDC-provider plugin (checked with `neon neon-auth plugins list`, Oct 2026). So the candidates are a self-hosted Better Auth instance running its OIDC-provider plugin, or a small authorization server of our own. [04-mcp](04-mcp.md) weighs the same choice for the MCP server. Either way, an access token must end in the same place an API key does: a verified user id handed to `userDb()`.

| Piece | What it does |
|---|---|
| **Discovery** | The authorization server publishes `/.well-known/oauth-authorization-server`, so clients find the endpoints automatically (`proxy.ts` already exempts `/.well-known/`) |
| **Client types** | *Confidential* (a company's backend with a secret) and *public* (CLI, desktop AI apps, no secret, must use PKCE) |
| **Consent page** | New `app/oauth/consent/page.tsx`. Requires a signed-in user and shows the app name, redirect host, an **"Unverified app"** badge for dynamically registered clients, and scope checkboxes |
| **Access token** | A signed token carrying `sub`, `client_id`, `exp`. `withApi` verifies it, then runs the request as `userDb(sub)` |
| **Connected apps page** | New `app/(app)/settings/connected-apps/page.tsx`: list grants, revoke |

**We keep our own record of the scopes the user approved**, rather than trusting whatever the token carries.

**New table `oauth_grants`**: `id`, `owner_id`, `client_id`, `scopes text[]`, `granted_at`, `revoked_at`, unique (`owner_id`, `client_id`).

On each OAuth request, `withApi` verifies the token, then looks up the grant by (`sub`, `client_id`). A revoked grant gets `401` immediately, even if the token hasn't expired.

> **Verify at build time:** re-check `neon neon-auth plugins list` in case Neon has since added an OAuth-provider plugin. Otherwise, check that whichever authorization server we pick supports dynamic client registration, a consent page we control, and loopback redirect port rules for public clients.

### 3.4 Scopes

As shipped (`lib/auth/scopes.ts`):

| Scope | Allows |
|---|---|
| `business:read` | Read the business profile (name, country, currency, tax ID, bank details) |
| `clients:read` / `clients:write` | List/get customers / create, update, archive (the API resource is `customers`; the table and scope kept the old name) |
| `products:read` / `products:write` | Products and prices: list/get / create, update, archive |
| `invoices:read` | List, get, PDF, events, line items |
| `invoices:write` | Create, update, delete **drafts** and their line items |
| `invoices:finalize` | Finalize (assigns a number) and void |
| `invoices:send` | Email an invoice to a client |
| `payments:write` | Mark an invoice paid |
| `webhooks:manage` | Create, list, delete webhook endpoints |

Managing API keys and OAuth grants is **never** available through the API, only in the web UI. A leaked key can't mint more keys.

### 3.5 Endpoints

"Idem." means the `Idempotency-Key` header. *Required* endpoints reject requests without one (`428`). As shipped (`app/api/v1/**`):

| Method | Path | Scope | Idem. | Service call |
|---|---|---|---|---|
| GET | `/api/v1/business` | business:read | — | `business.getPrimary` |
| GET / POST | `/api/v1/customers` | clients:read / clients:write | POST optional | `clients.list` / `clients.create` |
| GET / PATCH / DELETE | `/api/v1/customers/{id}` | clients:read / clients:write | — | `clients.get` / `update` / `archive` |
| GET / POST | `/api/v1/products`, `/api/v1/prices` | products:read / products:write | POST optional | `products.*`, `prices.*` |
| GET / PATCH / DELETE | `/api/v1/products/{id}`, `/api/v1/prices/{id}` | products:read / products:write | — | `get` / `update` / `archive` |
| GET | `/api/v1/invoices?status=&customer=&from=&to=&cursor=&limit=` | invoices:read | — | `invoices.list` |
| POST | `/api/v1/invoices` | invoices:write | **required** | `invoices.createDraft` |
| GET | `/api/v1/invoices/{id}` | invoices:read | — | `invoices.get` |
| PATCH / DELETE | `/api/v1/invoices/{id}` (drafts only) | invoices:write | — | `invoices.updateDraft` / `deleteDraft` |
| GET / POST | `/api/v1/invoice-items` | invoices:read / invoices:write | POST **required** | `invoices.get` / `addItem` |
| GET / DELETE | `/api/v1/invoice-items/{id}` | invoices:read / invoices:write | — | `invoices.findItem` / `removeItem` |
| GET | `/api/v1/invoices/{id}/pdf` | invoices:read | — | `invoices.pdf` |
| GET | `/api/v1/invoices/{id}/events` | invoices:read | — | `invoices.events` |
| POST | `/api/v1/invoices/{id}/finalize` | invoices:finalize | **required** | `invoices.finalize` |
| POST | `/api/v1/invoices/{id}/send` | invoices:send | **required** | `invoices.send` (finalizes a draft first) |
| POST | `/api/v1/invoices/{id}/pay` | payments:write | **required** | `invoices.pay` |
| POST | `/api/v1/invoices/{id}/void` `{ reason }` | invoices:finalize | **required** | `invoices.voidInvoice` |
| GET / POST | `/api/v1/webhook-endpoints` | webhooks:manage | POST optional | `webhooks.list` / `create` |
| DELETE | `/api/v1/webhook-endpoints/{id}` | webhooks:manage | — | `webhooks.remove` |
| GET | `/api/v1/openapi.json` | public | — | generated spec |

Finalized invoices can't be `DELETE`d, only voided, so every number spent stays accounted for. The planned `POST /webhook-endpoints/{id}/test` was not built; the CLI's `webhooks test` signs a sample event locally instead.

### 3.6 Idempotency

**The failure it prevents:** the SDK sends "issue invoice", our server finalizes it (number `INV-0042`), and the response is lost on a flaky connection. The SDK retries. Without idempotency, the retry spends `INV-0043` and the first number becomes a gap in the series.

**New table `idempotency_keys`**

| Column | Notes |
|---|---|
| `owner_id`, `key` | primary key together, so keys are per-owner |
| `method`, `path`, `request_hash` | SHA-256 of method + path + body |
| `state` | `in_progress` / `completed` |
| `response_status`, `response_body` jsonb | stored on completion |
| `created_at`, `expires_at` | kept 24 hours |

| Situation | Response |
|---|---|
| First time seen | claim row `in_progress` → run → store response → return it |
| Same key, same body, completed | replay stored response with header `Idempotent-Replayed: true` |
| Same key, still `in_progress` | `409 Conflict`, retry shortly |
| Same key, **different** body | `422` `idempotency_mismatch`, a client bug |

The database is the second line of defence: the `issue_invoice` RPC from [00-foundation.md](00-foundation.md) returns the *existing* number if the invoice is already finalized.

**Show the students:** run the same `curl -X POST …/finalize -H 'Idempotency-Key: demo-1'` twice. Same number, and the second response has `Idempotent-Replayed: true`.

### 3.7 Conventions

**Errors: RFC 9457 `application/problem+json`**

```json
{
  "type": "https://invoice.horizonpay.co/problems/invalid-state",
  "title": "Invoice is not a draft",
  "status": 409,
  "detail": "This invoice has been finalized and can no longer be edited.",
  "instance": "req_01J9Z…",
  "code": "invalid_state",
  "errors": []
}
```

| ServiceError code (from 00) | HTTP status |
|---|---|
| `validation` | 422 (with `errors: [{ path, message }]`) |
| `not_found` | 404. This is also returned for other owners' ids, so we never reveal existence |
| `invalid_state` | 409 |
| `conflict` | 409 |
| `forbidden` | 403 |
| `upstream_failed` | 502 (e.g. Resend down) |
| missing/invalid credential | 401 with `WWW-Authenticate: Bearer` |
| rate limited | 429 with `Retry-After` |

- **Pagination:** opaque cursor over (`created_at`, `id`), `limit` ≤ 100, response `{ "data": [...], "next_cursor": "…" | null }`.
- **Versioning:** major version in the URL (`/v1`). Additive changes (new fields, new endpoints) don't bump it; breaking changes mean `/v2`, with `Deprecation` and `Sunset` headers on v1.
- **Money:** integer **minor units** of the invoice's currency, Stripe-style (`unit_amount: 2500000` is ₹25,000.00; `2500` is $25.00; JPY has no decimals), converted in `lib/api/serialize.ts` with the exponents in `lib/currency.ts`, so there are no floats in the contract. Tax rates are numbers (`18`). Dates are ISO `YYYY-MM-DD`.
- **Headers:** `X-Request-Id` (accepted and echoed), `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

### 3.8 OpenAPI: one source of truth

```
lib/validators.ts (zod, incl. the wire schemas)
                                                 │
                                                 ▼
                                  lib/api/openapi.ts: zod-openapi createDocument({ openapi: '3.1.0', … })
                                                 │
                 ┌───────────────────────────────┼──────────────────────────────┐
                 ▼                               ▼                              ▼
     GET /api/v1/openapi.json     api-docs/openapi.json (pnpm openapi:gen)   docs/platform/postman/
                                  CI fails if it is stale                    (pnpm postman:gen)
                                  invoice-ai-sdk pulls it to regenerate the SDKs
```

The same zod schema validates the request at runtime **and** documents it, so the docs can't lie.

### 3.9 Webhooks

**Events (v1, as shipped in `lib/webhooks/events.ts`):**
- `invoice.created`, `invoice.updated`
- `invoice.finalized`
- `invoice.emailed`, `invoice.email_failed`
- `invoice.viewed`, `invoice.downloaded`
- `invoice.paid`, `invoice.voided`

There's no `invoice.overdue` in v1: overdue is calculated when read (`lib/invoice-status.ts#deriveStatus`) and never stored, so there's no moment to fire it.

**Outbox pattern, so events are never lost:**
- Every state change already writes an `invoice_events` row (after the fixes in 00).
- A database trigger on `invoice_events` inserts one `webhook_deliveries` row per subscribed endpoint, **in the same transaction**.
- This also catches `viewed` and `downloaded`, which are written by the public `log_public_invoice_event` RPC and never pass through the API.

**New tables**

| `webhook_endpoints` | `webhook_deliveries` |
|---|---|
| `id`, `owner_id` (RLS) | `id` (sent as `webhook-id`) |
| `url` (https only) | `endpoint_id`, `event_type`, `payload` jsonb |
| `secret` (shown once; stored as plain text today, see open decisions) | `attempt`, `status` (pending / succeeded / failed / dead) |
| `events text[]`, `active` | `next_attempt_at`, `response_code`, `last_error` |
| `failure_count`, `disabled_at`, `created_at` | `created_at` |

**Signing ([Standard Webhooks](https://www.standardwebhooks.com/) format):**

```
webhook-id:        msg_2Kf…
webhook-timestamp: 1789371234
webhook-signature: v1,<base64( HMAC-SHA256(secret, "{id}.{timestamp}.{raw body}") )>
```

Receivers recompute the HMAC and **reject timestamps older than 5 minutes** (replay protection). The SDK ships `webhooks.verify()` so integrators don't hand-roll it.

**Delivery:**
- Planned: the first attempt runs right after the request (Next.js `after()`). **As built**, every attempt, the first included, runs from the Vercel Cron route `app/api/cron/webhooks/route.ts`.
- Retries back off at 1m, 5m, 30m, 2h, 8h and 24h (`lib/webhooks/deliver.ts`), then the delivery is marked `dead`. The cron in `vercel.json` runs **daily** (Hobby plan limit), so in practice a delivery can wait up to 24h; on Pro, run it every few minutes.
- An endpoint is disabled after 20 deliveries in a row that used up every retry and were marked dead (`finish_webhook_delivery`); single failed attempts do not count. Emailing the owner when that happens is not built.

### 3.10 Rate limits and audit

| Layer | What | Why |
|---|---|---|
| **Edge** | Vercel WAF `rate_limit` rule on `/api/v1/*`, keyed by IP | Stops floods before they reach a function. Blocked requests aren't billed |
| **App** | Per-credential quota inside `withApi` (`lib/api/rate-limit.ts`). Counters are per-instance memory today; a Marketplace Redis store is a one-function swap. Starting points: 120 requests/min per credential, 10 sends/hour | WAF can't key on API keys (header keys are Enterprise-only), and WAF counters are per region |
| **Audit** | New table `api_requests`: `request_id`, `owner_id`, `via`, `api_key_id`, `client_id`, `method`, `route`, `status`, `duration_ms`, `idempotency_key`, `ip_hash`, `created_at` (30-day cleanup) | "Which app issued this invoice?" must have an answer |

Roll out WAF rules as **log → preview → production** (see the Vercel Firewall rollout practice) so a bad rule can't block real users.

## 4. Build phases

| Phase | Scope | Acceptance criteria | Teaching checkpoint |
|---|---|---|---|
| **A1: Read-only API with keys** | `withApi`, proxy exemption, `api_keys` + settings page, key → `userDb(owner)`, all `GET` endpoints, problem+json, `openapi.json` | `curl` with a key lists only the owner's invoices. Another user's id returns 404. A revoked key returns 401 | Run the same `select` as the owner and as `authenticated` with `app.user_id` set, and explain why the counts differ |
| **A2: Writes + idempotency** | Draft/issue/send/mark-paid/cancel endpoints, `idempotency_keys`, rate limits, `api_requests` | The same `Idempotency-Key` sent twice to `/issue` gives one number plus `Idempotent-Replayed: true`. A different body gives 422 | Simulate a lost response and a retry, before and after idempotency |
| **A3: Webhooks** | Outbox trigger, endpoints API, signing, `after()` delivery, Cron retries, SSRF guard | A local receiver verifies the signature. A failing endpoint shows the retry schedule, then `dead` | Students write a 10-line receiver that rejects a tampered body |
| **A4: OAuth** | An authorization server (see 3.3), consent page, `oauth_grants`, connected-apps page, token verification in `withApi` | A test public client completes PKCE. A missing scope gives 403. A revoked grant gives 401 immediately | Walk through the consent screen as the user, then as the attacker registering a fake app |

## 5. Security and abuse

- **Keys:**
  - hashed with a pepper and compared in constant time
  - shown once, prefixed for secret scanning, optional expiry, `last_used_at` visible
- **RLS stays the tenant guard.** API requests run as `authenticated` with `app.uid()` pinned to the key's owner (`userDb()`). The owner connection (`systemDb()`) is never used for tenant data; ESLint lets only the webhook cron import it.
- **Scopes are enforced on the server** in `withApi`, never trusted from the client. Credential management is UI-only.
- **Enumeration:** other owners' resources return `404`, not `403`.
- **Webhook SSRF guard:**
  - HTTPS only
  - resolve DNS and block private, loopback and link-local ranges
  - no redirects, 10-second timeout, response body not stored beyond a short error excerpt
- **Dynamic client registration can be spammed.** Consent shows an "Unverified app" badge and the redirect host, and grants are per client and revocable.
- **Cost abuse:** the endpoints that cost money per call (AI parse and transcribe) are excluded from v1. Sends are capped per hour.
- **`API_KEY_PEPPER` and the database URLs are the root secrets.** The pepper makes stored hashes uncheckable without it (changing it invalidates every key); `DATABASE_URL*` log in as the owner role, which bypasses RLS. Keep them only in Vercel env (sensitive).

## 6. Open decisions

- **Quotas:** exact numbers per credential, and whether sends/hour differ for API keys vs OAuth apps.
- **Vercel plan tier:** per-minute Cron for webhook retries, and the Rate Limiting SDK availability.
- **Encryption for webhook secrets at rest:** a Postgres extension (`pgcrypto`) vs app-level encryption with an env key.
- **Resends:** whether `send` to the same address within 24h is a replay (same idempotency key) or needs an explicit `resend` flag.

> ### How the MCP story uses this layer
> When Claude runs "invoice Acme and email it", **every tool call becomes an API request** carrying the user's OAuth token.
> - The **OAuth grant** is Claude's permission slip. The user ticked `invoices:finalize` and `invoices:send` on the consent screen.
> - The **Idempotency-Key** means a model that retries "email it" can't burn a second invoice number or send two emails.
> - The **webhooks** `invoice.finalized` and `invoice.emailed` let the user's accounting tool react without Claude doing anything more.

## 7. Five-minute demo order

1. Settings → API keys → create "Demo" with `invoices:read`. *"Copy it now, you'll never see it again."*
2. `curl -H "Authorization: Bearer inv_live_…" https://<site>/api/v1/invoices`. Your invoices, as JSON.
3. `curl` a write endpoint with the same read-only key: `403 insufficient scope`, as problem+json.
4. Finalize a draft twice with the same `Idempotency-Key`: one number, and the second response is a replay.
5. Revoke the key in settings and re-run step 2: `401`. *"Revocation is instant."*
