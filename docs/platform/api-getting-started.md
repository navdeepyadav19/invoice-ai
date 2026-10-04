# Invoice-AI API — getting started

The machine-readable contract is at `GET /api/v1/openapi.json` (no auth needed).
A Postman collection generated from it lives in [`postman/`](postman/).

## 1. Deployment setup

The API is off until `API_KEY_PEPPER` exists alongside the database URL. Until
then every request returns `401`, and the web app behaves exactly as before.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon's pooled connection string. Injected by the Vercel ↔ Neon integration; `vercel env pull .env.local` fetches it locally. |
| `API_KEY_PEPPER` | Long random string. `api_keys` stores `HMAC(pepper, secret)`, so a read-only leak of that table yields hashes nobody can check. **Changing it invalidates every key.** |
| `CRON_SECRET` | Webhook delivery only: the bearer token Vercel Cron sends to `/api/cron/webhooks`. |

There is no signing key any more. A verified key resolves to its owner's id,
and the request's queries run as that owner under RLS (`userDb()` in
`lib/db/index.ts`). Migrations must be applied first: `pnpm db:migrate`.

## 2. Create a key

Settings → API keys. Pick the narrowest scopes that do the job — a key that can
read invoices cannot email your clients unless you tick that too.

**The key is shown once.** We store a hash, so it genuinely cannot be shown
again; lose it and you revoke and make another.

```
inv_live_ab12cd34_7Kf9QmXz2pR4vNt6LwYb8HsJ3dGc5eAu
└──┬───┘ └──┬───┘ └───────────────┬──────────────┘
   │        │                     └─ secret, never stored
   │        └─ public id, used to find the row
   └─ greppable marker, so a leaked key is detectable
```

## 3. First call

```bash
curl https://your-site/api/v1/invoices \
  -H "Authorization: Bearer inv_live_..."
```

```json
{ "data": [ … ], "next_cursor": "MjAyNi0wOS0xN…" }
```

Pass `next_cursor` back as `?cursor=` for the next page. It is opaque — don't
parse it.

## 4. Things that will bite you if you skip them

### Money is in minor units

Every amount is an integer in the currency's smallest unit, the way Stripe
does it: `total: 2950000` on an INR invoice is ₹29,500.00, `2500` on a USD
invoice is $25.00, and `5000` on a JPY invoice is ¥5,000 (no decimals). The
exponent per currency lives in `lib/currency.ts`. Never decimals — JSON numbers
are IEEE doubles and a contract carrying `0.1 + 0.2` eventually disagrees with
itself about a total.

### Writes that create or change an invoice need an Idempotency-Key

```bash
curl -X POST https://your-site/api/v1/invoices/$ID/finalize \
  -H "Authorization: Bearer inv_live_..." \
  -H "Idempotency-Key: $(uuidgen)"
```

`POST /invoices`, `POST /invoice-items` and the `finalize`, `send`, `pay` and
`void` actions return `428` without one. On `customers`, `products`, `prices`
and `webhook-endpoints` the header is optional but honoured. Retry with the
**same** key and you get the first response back plus `Idempotent-Replayed: true`.

Generate one key per *request*, not per retry loop. Reusing a key with a
different body is `422 idempotency_mismatch` — that error exists because
replaying the first response for a different request would silently return
invoice A when you asked for B.

This matters more here than in most APIs: finalizing runs `issue_invoice()`,
which advances the business's invoice counter, so a retry without a key would
spend `INV-0043` while the lost response held `INV-0042`, leaving a gap in a
series that should be consecutive.

### `overdue` is computed, not stored

The stored statuses are `draft`, `open`, `paid` and `void`. `overdue` is derived
from `due_date` at read time for an `open` invoice. Nothing ever writes an
`overdue` row, so there is no `invoice.overdue` webhook — poll
`?status=overdue` instead.

### Finalized is not the same as emailed

`open` means "has an invoice number", not "the email went out". The events are
`invoice.finalized` and `invoice.emailed` separately, and `POST /send` finalizes
a draft first if it needs to.

### Errors are problem+json

```json
{
  "type": "https://invoice.horizonpay.co/problems/invalid-state",
  "title": "Invalid state for this operation",
  "status": 409,
  "detail": "Invoice is void and cannot be marked paid.",
  "instance": "req_01J9Z…",
  "code": "invalid_state"
}
```

Branch on `code`. `detail` is for humans and may be reworded. `instance` is the
`X-Request-Id` — quote it if you contact support.

Another owner's id returns **404, not 403**, so ids cannot be enumerated by
probing.

## 5. Webhooks

```bash
curl -X POST https://your-site/api/v1/webhook-endpoints \
  -H "Authorization: Bearer inv_live_..." \
  -H "Content-Type: application/json" \
  -d '{"url":"https://you.example/hooks","events":["invoice.finalized","invoice.paid"]}'
```

The signing secret is in that response and **only** that response.

Each delivery carries [Standard Webhooks](https://www.standardwebhooks.com/)
headers:

```
webhook-id:        msg_…
webhook-timestamp: 1789371234
webhook-signature: v1,<base64 HMAC-SHA256>
```

Verify over `"{id}.{timestamp}.{raw body}"` — the id and timestamp are *inside*
the signed string, which is what makes a captured request un-replayable. Reject
anything more than five minutes old, and compare in constant time.

Delivery is at-least-once: deduplicate on `webhook-id`. Retries run at 1m, 5m,
30m, 2h, 8h and 24h, then the delivery is marked dead.

## 6. What v1 deliberately leaves out

| Not included | Why |
|---|---|
| Business profile writes | Onboarding sets country, currency and numbering together. A bare PATCH could reach a state the UI cannot produce. |
| AI parse / transcribe | Costs money per call. |
| API key management | UI only, so a leaked key cannot mint more keys. |
| Credit notes | A *paid* invoice can't be voided; reversing one needs a credit note. Out of scope. |
| OAuth | Planned. API keys (and the CLI's device login, which issues one) first. |
