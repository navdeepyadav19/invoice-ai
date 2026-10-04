# 02 · TypeScript SDK (`@invoice-ai/sdk`)

> **Depends on:** [01-api.md](01-api.md) (its OpenAPI document).
> **Needed by:** [03-cli.md](03-cli.md), [04-mcp.md](04-mcp.md).
>
> **Status (Oct 2026): built, differently from this plan, and moved out of this repo.** The SDKs live in the public repo [navdeepyadav19/invoice-ai-sdk](https://github.com/navdeepyadav19/invoice-ai-sdk): TypeScript as `@horizonpay/invoice-ai` (`packages/sdk-ts`) and Python as `horizonpay-invoice-ai` (`packages/sdk-python`), both generated from `api-docs/openapi.json` by that repo's own generator rather than `openapi-fetch`, with zero runtime dependencies. The surface is Stripe-style (`new InvoiceAI()`, `customers.create`, `invoices.finalize` / `send` / `pay` / `void`, `webhooks.constructEvent`). npm/PyPI publishing is pending. This repo's part is the spec: `pnpm openapi:gen` writes `api-docs/openapi.json`, CI fails if it's stale, and invoice-ai-sdk pulls it to regenerate. The rest of this document is the original plan, kept for the teaching story.

## 1. What this layer is, and what students learn

An SDK is a **phrasebook printed from the official dictionary**. Anyone can speak raw HTTP to the API, but they'll misspell field names, forget the idempotency header, and write their own retry loop badly. An SDK gives them `invoices.issue(id)` with autocomplete, typed responses and safe retries built in.

Students leave this module understanding:

1. **Contract-first code generation.** Types come *from* the OpenAPI document, so the SDK can't drift from the API.
2. **Some problems belong in the client:**
   - retries with backoff
   - reusing one idempotency key across retries
   - pagination
   - turning error JSON into real exceptions
3. **The difference between a thin generated layer and a hand-written friendly layer**, and why you want both.

## 2. How it works in this repo today

*(As planned, before the SDK existed.)*

- **There is no SDK, and no workspace packages.** `pnpm-workspace.yaml` exists but only contains `allowBuilds` settings. (Still true here: the packages went to invoice-ai-sdk.)
- **The contract will come from zod.** [01-api.md](01-api.md) generates `openapi.json` from the zod schemas in `lib/validators.ts` via `lib/api/openapi.ts`. That document is the SDK's input.
- **Business types exist but aren't shareable as they are.** `lib/database.types.ts` and `lib/invoice-view.ts` describe database rows and view models. The SDK must *not* import them, because API shapes (minor units, snake_case, cursors) are a separate public contract from database internals.

## 3. Design

### 3.1 Package layout (all new)

```
packages/sdk/
├── package.json            name "@invoice-ai/sdk", "type": "module", engines node >= 20
├── openapi.json            snapshot of GET /api/v1/openapi.json (committed)
├── src/
│   ├── generated/
│   │   └── schema.d.ts     output of openapi-typescript (committed, never hand-edited)
│   ├── client.ts           createInvoiceAI(): wires openapi-fetch + middleware
│   ├── middleware/
│   │   ├── auth.ts         Authorization: Bearer <apiKey | access token>
│   │   ├── idempotency.ts  one key per logical call, reused on retry
│   │   └── retry.ts        429 / 5xx / network → backoff, honours Retry-After
│   ├── resources/
│   │   ├── invoices.ts
│   │   ├── clients.ts
│   │   ├── business.ts
│   │   └── webhook-endpoints.ts
│   ├── paginate.ts         async iterator over next_cursor
│   ├── errors.ts           InvoiceAIError from problem+json
│   └── webhooks.ts         verify(): Standard Webhooks signature check
└── test/
```

- **Build:** `tsup` to ESM with `.d.ts`.
- **One runtime dependency:** `openapi-fetch`. Its only job is to make the network call.
- **Types:** `openapi-typescript` runs at dev time only.
- **The Next.js app does not import the SDK.** The app calls services directly; the SDK is for *external* callers.

### 3.2 Generation pipeline

```bash
# packages/sdk: "generate" script
curl -s http://localhost:3000/api/v1/openapi.json > openapi.json   # or import lib/api/openapi.ts directly
npx openapi-typescript openapi.json -o src/generated/schema.d.ts
```

**CI check (as built, the `api-docs` job in `.github/workflows/ci.yml`):**
1. `pnpm openapi:gen && pnpm postman:gen` regenerate `api-docs/openapi.json` and the Postman collection from `lib/api/openapi.ts`.
2. `git diff --exit-code -- api-docs/openapi.json docs/platform/postman`.

The SDK-side check (regenerate the SDKs from the spec, fail on drift) runs in invoice-ai-sdk.

If someone changes an API schema without regenerating, the build fails. **That failure is the lesson.**

### 3.3 Public surface

```ts
import { createInvoiceAI } from '@invoice-ai/sdk'

const invoiceAI = createInvoiceAI({
  apiKey: process.env.INVOICE_AI_API_KEY,        // scripts and servers
  // or: getAccessToken: async () => oauthToken, // OAuth apps, CLI, MCP
  baseUrl: 'https://invoice.horizonpay.co/api/v1',        // default: production
  maxRetries: 2,
})
```

| Resource | Methods |
|---|---|
| `invoiceAI.business` | `get()` |
| `invoiceAI.clients` | `list({ query?, cursor?, limit? })`, `listAll(...)` (async iterator), `get(id)`, `create(body)`, `update(id, body)`, `archive(id)` |
| `invoiceAI.invoices` | `list(filters)`, `listAll(filters)`, `get(id)`, `createDraft(body, opts?)`, `updateDraft(id, body)`, `deleteDraft(id)`, `issue(id, opts?)`, `send(id, { to? }, opts?)`, `markPaid(id, { paidOn?, reference? }, opts?)`, `cancel(id, { reason }, opts?)`, `pdf(id)` → `ArrayBuffer`, `events(id)` |
| `invoiceAI.webhookEndpoints` | `list()`, `create({ url, events })`, `remove(id)`, `sendTest(id)` |
| `webhooks` (static) | `verify(rawBody, headers, secret)` → parsed event, or throws `WebhookVerificationError` |

`opts` is `{ idempotencyKey?: string, signal?: AbortSignal }`.

The resource layer is hand-written but **typed from `schema.d.ts`**. For example, `createDraft`'s `body` type *is* `paths['/invoices']['post']['requestBody']['content']['application/json']`.

### 3.4 Behaviour that makes it worth using

**Auth middleware** (`openapi-fetch` `client.use({ onRequest })`):
- sets `Authorization: Bearer …` on every request
- `getAccessToken` is called per request, so a CLI can refresh an expired OAuth token transparently

**Idempotency middleware:**
- For writes that the API marks *required*, the SDK generates a UUID **once per logical call**, and **the same key is reused on every retry of that call**.
- A caller-supplied `idempotencyKey` wins. The CLI uses this to print the key so a human can retry safely after Ctrl-C.

**Retry middleware:**

| Retry? | When |
|---|---|
| Yes | Network errors, `429`, `502`, `503`, `504` on `GET`s and on writes that carry an idempotency key |
| No | `4xx` other than `429` (a client bug, retrying won't help), and writes *without* a key |
| Timing | exponential backoff with jitter, capped at `maxRetries`, and `Retry-After` wins when present |

**Errors:**

```ts
try {
  await invoiceAI.invoices.updateDraft(id, body)
} catch (err) {
  if (err instanceof InvoiceAIError && err.code === 'invalid_state') {
    // already issued, can't edit
  }
  // err.status, err.title, err.detail, err.errors, err.requestId
}
```

**Pagination:**

```ts
for await (const invoice of invoiceAI.invoices.listAll({ status: 'sent' })) {
  // follows next_cursor until null
}
```

**Show the students:** in the editor, type `invoiceAI.invoices.issue(` and show the autocomplete. Then rename a field in its zod schema in `lib/validators.ts`, regenerate, and watch every SDK call site turn red.

### 3.5 Testing

- **Unit** (Vitest, same runner as the app's `lib/**/*.test.ts`):
  - mocked `fetch` that returns `429` then `200`, asserting one idempotency key across both attempts
  - problem+json turned into `InvoiceAIError`
  - `webhooks.verify` against a known-good and a tampered payload
- **Contract:** run against `pnpm dev` with a seeded API key, covering the north-star flow `clients.create` → `invoices.createDraft` → `issue` → `get`.

## 4. Build phases

| Phase | Scope | Acceptance criteria | Teaching checkpoint |
|---|---|---|---|
| **S1: Generated types + raw client** | Workspace entry in `pnpm-workspace.yaml`, `packages/sdk` scaffold, `openapi.json` snapshot, `schema.d.ts`, bare `openapi-fetch` client with auth | `tsc` rejects a misspelled field. A raw call lists invoices with an API key | "Where do these types come from?" Trace one field from zod to `.d.ts` |
| **S2: Resources, retries, pagination, errors** | `resources/*`, the three middlewares, `paginate.ts`, `errors.ts`, CI drift check | Killing the connection after the server issued an invoice, then letting the SDK retry, yields **one** invoice number | Show the retry log: same key, second response replayed |
| **S3: Webhook verify + publish dry run** | `webhooks.verify`, README with examples, `npm publish --dry-run` | Tampered body → `WebhookVerificationError`. Package installs into a scratch project | Students verify a real webhook from A3 with 3 lines of SDK code |

## 5. Security and abuse

- **Never log secrets.** Redact `Authorization` from errors, debug logs and `InvoiceAIError.toJSON()`.
- **Warn if `apiKey` is used in a browser** (`typeof window !== 'undefined'`). API keys belong on servers; browsers should use OAuth.
- **`webhooks.verify` uses constant-time comparison** and enforces the 5-minute timestamp tolerance, so integrators get replay protection by default.
- **No telemetry or phone-home** in the SDK.
- **Supply chain:** one runtime dependency, provenance-signed npm publishes from CI (not from a laptop), and a lockfile committed.

## 6. Open decisions

- **npm scope and name:** `@invoice-ai/sdk` needs an npm org. Pick before the first publish.
- **Release tooling:** Changesets vs manual versioning, and the semver policy tied to API `/v1`.
- **Other languages:** a Python SDK would be generated from the same `openapi.json` later. It's out of scope for v1.
- **Where the spec snapshot is produced:** importing `lib/api/openapi.ts` directly vs fetching from a running dev server. Importing is faster in CI but couples the package to app code at build time.

> ### How the MCP story uses this layer
> Every MCP tool in [04-mcp.md](04-mcp.md) is a few lines around an SDK call. `issue_invoice` is essentially `invoiceAI.invoices.issue(id, { idempotencyKey: \`issue:${id}\` })`. Retries, idempotency and error mapping are solved **once, here**, so the MCP server, the CLI and every third-party integrator get the same safety for free.

## 7. Five-minute demo order

1. Show `api-docs/openapi.json`. *"The dictionary."*
2. Show the generated SDK in invoice-ai-sdk (`packages/sdk-ts`). *"Printed automatically from the dictionary, never typed by hand."*
3. Write a 6-line script: create the client with an API key, `for await` over `invoices.listAll()`, print numbers.
4. Rename a field in the zod schema, regenerate, and show the red squiggles.
5. Run the "kill the connection mid-issue" test and show a single invoice number.
