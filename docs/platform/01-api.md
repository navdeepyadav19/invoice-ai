# 01 · REST API v1

> **Depends on:** [00-foundation.md](00-foundation.md). Every endpoint here is a thin wrapper around a service function.
> **Needed by:** [02-sdk.md](02-sdk.md), [03-cli.md](03-cli.md), [04-mcp.md](04-mcp.md).

## 1. What this layer is, and what students learn

An API is a **contract**: "send me this shape, and I promise to answer with that shape". Once other people build on it, you can't change it casually.

Students leave this module understanding four ideas:

1. **Identity comes in two kinds.**
   - An **API key** is like a building access card: whoever holds it gets in, and it identifies *a credential*.
   - **OAuth** is like a guest list the owner signed: it says *which user* approved *which app* to do *what*.
2. **Scopes** limit what a credential can do, even when it's valid.
3. **Idempotency.** A network retry must never create a second GST invoice number.
4. **Webhooks.** The API also *calls you* when something happens, and signs the request so you can trust it.

## 2. How it works in this repo today

- **There is no public API.** The only route handlers are:
  - `app/api/ai/parse-invoice/route.ts`, `app/api/ai/transcribe/route.ts` (OpenAI)
  - `app/api/invoices/[id]/pdf/route.ts` (the owner's PDF)
  - `app/api/public/[token]/pdf/route.ts` (public share-link PDF)
  - `app/auth/callback/route.ts`
- **Authentication is cookie-only.** `lib/supabase/server.ts` builds the Supabase client from browser cookies, and nothing reads an `Authorization` header.
- **`lib/supabase/proxy.ts` redirects every non-public path to `/login`.** A program calling `/api/v1/invoices` with a bearer token would get an HTML redirect today, not a `401`.
- **Tenant isolation is RLS** (`owner_id = auth.uid()`) on every table in `supabase/migrations/0001_init.sql`. This is good: the API design below keeps RLS as the guard instead of replacing it.

**Show the students:** run `curl -i https://<site>/api/invoices/<id>/pdf` without a cookie. You get a redirect to `/login`, which is fine for browsers and useless for programs.

## 3. Design

### 3.1 The request pipeline

Every route under `app/api/v1/**/route.ts` (new) is wrapped by one helper, `lib/api/handler.ts#withApi` (new):

```ts
// app/api/v1/invoices/[id]/issue/route.ts (new), shape only
export const POST = withApi(
  { scope: 'invoices:issue', idempotent: 'required' },
  async (ctx, req, { params }) => invoices.issue(ctx, (await params).id),
)
```

`withApi` runs the same steps, in the same order, for every request:

```
1. request id      read X-Request-Id or generate one, echo it back
2. authenticate    API key ─► mint user JWT   |   OAuth token ─► verify + grant lookup
3. rate limit      per credential quota → 429 + Retry-After
4. scope check     ctx.scopes must include the route's scope → 403
5. idempotency     claim Idempotency-Key (writes only) → replay / 409 / 422
6. validate        zod parse of params, query, body → 422 problem+json
7. call service    lib/services/* with the AuthContext
8. map errors      ServiceError → problem+json status
9. audit           write one api_requests row
```

`lib/supabase/proxy.ts` must **exempt** `/api/v1/`, `/api/mcp` and `/.well-known/` from the login redirect.

### 3.2 API keys (built first)

| Decision | Choice |
|---|---|
| Format | `inv_live_<8-char id>_<32-char base62 secret>`. The prefix makes leaked keys greppable and lets GitHub secret scanning spot them |
| Storage | Only an **HMAC-SHA256 hash** of the secret (with a server-side pepper `API_KEY_PEPPER`). The full key is shown **once** at creation |
| Where users manage them | New settings page `app/(app)/settings/api-keys/page.tsx`: create (name, scopes, optional expiry), list (prefix, last used), revoke |
| Who can create them | Signed-in, **non-anonymous** users only. Guest accounts are cleaned up by `cleanup_stale_guests` and must not leave orphaned credentials |

**New table `api_keys`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `owner_id` | uuid → auth.users | RLS: `owner_id = auth.uid()` |
| `name` | text | "Zapier", "My laptop" |
| `prefix` | text unique | `inv_live_ab12cd34`, used for lookup |
| `secret_hash` | text | HMAC-SHA256(pepper, secret) |
| `scopes` | text[] | subset of the scope list below |
| `created_at`, `last_used_at`, `expires_at`, `revoked_at` | timestamptz | |

#### How an API key still respects RLS (the important trick)

The tempting shortcut is to look up the key, then query the database with Supabase's **secret (service_role) key**. That key **bypasses RLS completely**, so one missing `.eq('owner_id', …)` anywhere would leak another business's invoices.

Instead, the key is exchanged for a *user* token:

```
Authorization: Bearer inv_live_ab12cd34_…
        │
        ▼
lib/auth/api-key.ts (new)  look up prefix → constant-time compare hash → not revoked/expired
        │
        ▼
lib/auth/mint.ts (new)     sign a 60-second JWT with OUR ES256 key (imported into Supabase):
                           { sub: owner_id, role: "authenticated", exp: now+60,
                             api_key_id, scopes }
        │
        ▼
lib/supabase/for-token.ts  Supabase client with the publishable key as `apikey`
(new, from 00)             and `Authorization: Bearer <minted JWT>`
        │
        ▼
Postgres sees role=authenticated, auth.uid() = owner_id → the same RLS as the browser
```

Supabase lets you **import your own signing key** (with a `kid`) so tokens you mint are accepted. The existing `claim_invoice_number` RPC already checks `auth.uid()` and is granted to `authenticated`, so it works unchanged with minted tokens.

> **Verify at build time:** does Supabase accept tokens from an imported key on *standby*, or only after rotating it to active? Once active it signs **every** session, which makes that private key the most sensitive secret in the system.

**Show the students:** paste a minted JWT into jwt.io. `sub` is the user, `role` is `authenticated`, and `exp` is 60 seconds away. The API key itself never reaches the database.

### 3.3 OAuth for third-party apps (built second)

Use **Supabase Auth's built-in OAuth 2.1 server**. We don't build our own authorization server.

```toml
# supabase/config.toml
[auth.oauth_server]
enabled = true
authorization_url_path = "/oauth/consent"
allow_dynamic_registration = true   # lets MCP clients register themselves
```

| Piece | What it does |
|---|---|
| **Discovery** | Supabase publishes `/.well-known/oauth-authorization-server`, so clients find the endpoints automatically |
| **Client types** | *Confidential* (a company's backend with a secret) and *public* (CLI, desktop AI apps, no secret, must use PKCE) |
| **Consent page** | New `app/oauth/consent/page.tsx`. Requires a signed-in non-anonymous user and shows the app name, redirect host, an **"Unverified app"** badge for dynamically registered clients, and scope checkboxes |
| **Access token** | A Supabase JWT with `sub`, `role: authenticated`, `client_id`, `session_id`, `exp`. We verify it locally with `supabase.auth.getClaims()` |
| **Connected apps page** | New `app/(app)/settings/connected-apps/page.tsx`: list grants, revoke |

**Scopes aren't in Supabase's token**, so we keep our own record of what the user approved.

**New table `oauth_grants`**: `id`, `owner_id`, `client_id`, `scopes text[]`, `granted_at`, `revoked_at`, unique (`owner_id`, `client_id`).

On each OAuth request, `withApi` verifies the token, then looks up the grant by (`sub`, `client_id`). A revoked grant gets `401` immediately, even if the token hasn't expired.

> **Verify at build time:** the exact Supabase consent-page APIs (approve/deny), whether the OAuth server is still in beta, and loopback redirect port rules for public clients.

### 3.4 Scopes

| Scope | Allows |
|---|---|
| `business:read` | Read the business profile (name, GSTIN, state, bank details) |
| `clients:read` / `clients:write` | List/get clients / create, update, archive |
| `invoices:read` | List, get, PDF, events |
| `invoices:write` | Create, update, delete **drafts** |
| `invoices:issue` | Issue (assigns a GST number) and cancel |
| `invoices:send` | Email an invoice to a client |
| `payments:write` | Mark an invoice paid |
| `webhooks:manage` | Create, list, delete, test webhook endpoints |

Managing API keys and OAuth grants is **never** available through the API, only in the web UI. A leaked key can't mint more keys.

### 3.5 Endpoints

"Idem." means the `Idempotency-Key` header. *Required* endpoints reject requests without one (`428`).

| Method | Path | Scope | Idem. | Service call |
|---|---|---|---|---|
| GET | `/api/v1/business` | business:read | — | `business.getPrimary` |
| GET | `/api/v1/clients?query=&cursor=&limit=` | clients:read | — | `clients.list` |
| POST | `/api/v1/clients` | clients:write | optional | `clients.create` |
| GET | `/api/v1/clients/{id}` | clients:read | — | `clients.get` |
| PATCH | `/api/v1/clients/{id}` | clients:write | natural | `clients.update` |
| POST | `/api/v1/clients/{id}/archive` | clients:write | natural | `clients.archive` |
| GET | `/api/v1/invoices?status=&client_id=&from=&to=&cursor=&limit=` | invoices:read | — | `invoices.list` |
| POST | `/api/v1/invoices` | invoices:write | **required** | `invoices.createDraft` |
| GET | `/api/v1/invoices/{id}` | invoices:read | — | `invoices.get` |
| PATCH | `/api/v1/invoices/{id}` (drafts only) | invoices:write | natural | `invoices.updateDraft` |
| DELETE | `/api/v1/invoices/{id}` (drafts only) | invoices:write | natural | `invoices.deleteDraft` |
| GET | `/api/v1/invoices/{id}/pdf` | invoices:read | — | `invoices.pdf` |
| GET | `/api/v1/invoices/{id}/events` | invoices:read | — | `invoices.events` |
| POST | `/api/v1/invoices/{id}/issue` | invoices:issue | **required** | `invoices.issue` |
| POST | `/api/v1/invoices/{id}/send` `{ to? }` | invoices:send | **required** | `invoices.send` |
| POST | `/api/v1/invoices/{id}/mark-paid` `{ paid_on?, reference? }` | payments:write | **required** | `invoices.markPaid` |
| POST | `/api/v1/invoices/{id}/cancel` `{ reason }` | invoices:issue | **required** | `invoices.cancel` |
| GET / POST | `/api/v1/webhook-endpoints` | webhooks:manage | POST optional | `webhooks.*` |
| DELETE | `/api/v1/webhook-endpoints/{id}` | webhooks:manage | natural | `webhooks.remove` |
| POST | `/api/v1/webhook-endpoints/{id}/test` | webhooks:manage | — | `webhooks.sendTest` |
| GET | `/api/v1/openapi.json` | public | — | generated spec |

Issued invoices can't be `DELETE`d, only cancelled. GST requires issued numbers to stay accounted for.

### 3.6 Idempotency

**The failure it prevents:** the SDK sends "issue invoice", our server issues it (number `INV/26-27/0042`), and the response is lost on a flaky connection. The SDK retries. Without idempotency, the retry issues `0043` and the first number becomes a gap in the GST series.

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

The database is the second line of defence: the `issue_invoice` RPC from [00-foundation.md](00-foundation.md) returns the *existing* number if the invoice is already issued.

**Show the students:** run the same `curl -X POST …/issue -H 'Idempotency-Key: demo-1'` twice. Same number, and the second response has `Idempotent-Replayed: true`.

### 3.7 Conventions

**Errors: RFC 9457 `application/problem+json`**

```json
{
  "type": "https://invoice-ai.app/problems/invalid-state",
  "title": "Invoice is not a draft",
  "status": 409,
  "detail": "Invoice 7f3c… is already issued as INV/26-27/0042 and cannot be edited.",
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
- **Money:** integer **paise** (`rate_paise: 2500000` is ₹25,000), matching `lib/money.ts` and `lib/gst.ts`, so there are no floats in the contract. GST rates are numbers (`18`). Dates are ISO `YYYY-MM-DD`.
- **Headers:** `X-Request-Id` (accepted and echoed), `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.

### 3.8 OpenAPI: one source of truth

```
lib/validators.ts (existing zod)  ──►  lib/api/schemas.ts (new: API-shaped zod + .meta({ id }))
                                                 │
                                                 ▼
                                  lib/api/openapi.ts (new): zod-openapi createDocument({ openapi: '3.1.0', … })
                                                 │
                              ┌──────────────────┴───────────────────┐
                              ▼                                      ▼
                 GET /api/v1/openapi.json                packages/sdk/openapi.json (snapshot)
                                                         CI fails if the snapshot is stale
```

The same zod schema validates the request at runtime **and** documents it, so the docs can't lie.

### 3.9 Webhooks

**Events (v1):**
- `invoice.created`, `invoice.updated`
- `invoice.issued`
- `invoice.emailed`, `invoice.email_failed`
- `invoice.viewed`, `invoice.downloaded`
- `invoice.paid`, `invoice.cancelled`

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
| `secret` (encrypted at rest, shown once) | `attempt`, `status` (pending / succeeded / failed / dead) |
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
- The first attempt runs right after the request (Next.js `after()`).
- Retries run from a Vercel Cron route `app/api/cron/webhooks/route.ts` (new) at 1m, 5m, 30m, 2h, 8h and 24h, then the delivery is marked `dead`.
- An endpoint failing continuously for 3 days is disabled, and the owner is emailed.

### 3.10 Rate limits and audit

| Layer | What | Why |
|---|---|---|
| **Edge** | Vercel WAF `rate_limit` rule on `/api/v1/*`, keyed by IP | Stops floods before they reach a function. Blocked requests aren't billed |
| **App** | Per-credential quota inside `withApi`, counters in a Marketplace Redis. Starting points: 120 requests/min per credential, 10 sends/hour | WAF can't key on API keys (header keys are Enterprise-only), and WAF counters are per region |
| **Audit** | New table `api_requests`: `request_id`, `owner_id`, `via`, `api_key_id`, `client_id`, `method`, `route`, `status`, `duration_ms`, `idempotency_key`, `ip_hash`, `created_at` (30-day cleanup) | "Which app issued this invoice?" must have an answer |

Roll out WAF rules as **log → preview → production** (see the Vercel Firewall rollout practice) so a bad rule can't block real users.

## 4. Build phases

| Phase | Scope | Acceptance criteria | Teaching checkpoint |
|---|---|---|---|
| **A1: Read-only API with keys** | `withApi`, proxy exemption, `api_keys` + settings page, JWT minting, all `GET` endpoints, problem+json, `openapi.json` | `curl` with a key lists only the owner's invoices. Another user's id returns 404. A revoked key returns 401 | Decode a minted JWT on jwt.io and explain `sub` / `role` / `exp` |
| **A2: Writes + idempotency** | Draft/issue/send/mark-paid/cancel endpoints, `idempotency_keys`, rate limits, `api_requests` | The same `Idempotency-Key` sent twice to `/issue` gives one number plus `Idempotent-Replayed: true`. A different body gives 422 | Simulate a lost response and a retry, before and after idempotency |
| **A3: Webhooks** | Outbox trigger, endpoints API, signing, `after()` delivery, Cron retries, SSRF guard | A local receiver verifies the signature. A failing endpoint shows the retry schedule, then `dead` | Students write a 10-line receiver that rejects a tampered body |
| **A4: OAuth** | `[auth.oauth_server]`, consent page, `oauth_grants`, connected-apps page, token verification in `withApi` | A test public client completes PKCE. A missing scope gives 403. A revoked grant gives 401 immediately | Walk through the consent screen as the user, then as the attacker registering a fake app |

## 5. Security and abuse

- **Keys:**
  - hashed with a pepper and compared in constant time
  - shown once, prefixed for secret scanning, optional expiry, `last_used_at` visible
  - never available to anonymous users
- **RLS stays the tenant guard.** API requests run as `authenticated` through minted or OAuth user tokens. The Supabase secret key is never used for tenant data.
- **Scopes are enforced on the server** in `withApi`, never trusted from the client. Credential management is UI-only.
- **Enumeration:** other owners' resources return `404`, not `403`.
- **Webhook SSRF guard:**
  - HTTPS only
  - resolve DNS and block private, loopback and link-local ranges
  - no redirects, 10-second timeout, response body not stored beyond a short error excerpt
- **Dynamic client registration can be spammed.** Consent shows an "Unverified app" badge and the redirect host, and grants are per client and revocable.
- **Cost abuse:** the endpoints that cost money per call (AI, GSTIN lookup) are excluded from v1. Sends are capped per hour.
- **The imported signing key is the root secret.** Keep it only in Vercel env (sensitive) and document rotation.

## 6. Open decisions

- **Quotas:** exact numbers per credential, and whether sends/hour differ for API keys vs OAuth apps.
- **Vercel plan tier:** per-minute Cron for webhook retries, and the Rate Limiting SDK availability.
- **Signing key:** standby vs active-key behaviour (see 3.2).
- **Encryption for webhook secrets at rest:** Supabase Vault vs app-level encryption with an env key.
- **Resends:** whether `send` to the same address within 24h is a replay (same idempotency key) or needs an explicit `resend` flag.

> ### How the MCP story uses this layer
> When Claude runs "invoice Acme and email it", **every tool call becomes an API request** carrying the user's OAuth token.
> - The **OAuth grant** is Claude's permission slip. The user ticked `invoices:issue` and `invoices:send` on the consent screen.
> - The **Idempotency-Key** means a model that retries "email it" can't burn a second GST number or send two emails.
> - The **webhooks** `invoice.issued` and `invoice.emailed` let the user's accounting tool react without Claude doing anything more.

## 7. Five-minute demo order

1. Settings → API keys → create "Demo" with `invoices:read`. *"Copy it now, you'll never see it again."*
2. `curl -H "Authorization: Bearer inv_live_…" https://<site>/api/v1/invoices`. Your invoices, as JSON.
3. `curl` a write endpoint with the same read-only key: `403 insufficient scope`, as problem+json.
4. Issue a draft twice with the same `Idempotency-Key`: one number, and the second response is a replay.
5. Revoke the key in settings and re-run step 2: `401`. *"Revocation is instant."*
