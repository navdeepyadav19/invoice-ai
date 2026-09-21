# Invoice-AI API — getting started

The machine-readable contract is at `GET /api/v1/openapi.json` (no auth needed).
A Postman collection generated from it lives in [`postman/`](postman/).

## 1. Deployment setup

The API is off until four environment variables exist. Until then every request
returns `401`, and the web app behaves exactly as before.

| Variable | What it is |
|---|---|
| `API_KEY_PEPPER` | Long random string. `api_keys` stores `HMAC(pepper, secret)`, so a read-only leak of that table yields hashes nobody can check. **Changing it invalidates every key.** |
| `SUPABASE_JWT_PRIVATE_KEY` | ES256 private PEM. `supabase gen signing-key --algorithm ES256`, then import the public half in Supabase → Auth → Signing Keys. |
| `SUPABASE_JWT_KID` | The key id Supabase shows for that imported key. |
| `CRON_SECRET` + `SUPABASE_SERVICE_ROLE_KEY` | Webhook delivery only. |

Migrations `0004`–`0007` must be applied first.

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

### Money is in paise

`total_paise: 2950000` is ₹29,500. Never rupees, never decimals — JSON numbers
are IEEE doubles and a contract carrying `0.1 + 0.2` eventually disagrees with
itself about a total.

### Writes need an Idempotency-Key

```bash
curl -X POST https://your-site/api/v1/invoices/$ID/issue \
  -H "Authorization: Bearer inv_live_..." \
  -H "Idempotency-Key: $(uuidgen)"
```

Without one you get `428`. Retry with the **same** key and you get the first
response back plus `Idempotent-Replayed: true`.

Generate one key per *request*, not per retry loop. Reusing a key with a
different body is `422 idempotency_mismatch` — that error exists because
replaying the first response for a different request would silently return
invoice A when you asked for B.

This matters more here than in most APIs: `claim_invoice_number` advances a
counter, so a retry without a key would spend `INV/26-27/0043` while the lost
response held `0042`, leaving a permanent gap in a series GST requires to be
consecutive.

### `overdue` is computed, not stored

`status` comes from `due_date` at read time. Nothing ever writes an `overdue`
row, so there is no `invoice.overdue` webhook — poll `?status=overdue` instead.

### The status enum says `sent`, the API says `issued`

`sent` means "has a GST number", which is not the same as "the email went out".
Events are `invoice.issued` and `invoice.emailed` separately.

### Errors are problem+json

```json
{
  "type": "https://invoice-ai.app/problems/invalid-state",
  "title": "Invalid state for this operation",
  "status": 409,
  "detail": "Invoice is cancelled and cannot be marked paid.",
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
  -d '{"url":"https://you.example/hooks","events":["invoice.issued","invoice.paid"]}'
```

The signing secret is in that response and **only** that response.

Each delivery carries [Standard Webhooks](https://www.standardwebhooks.com/)
headers:

```
webhook-id:        <uuid>
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
| Business profile writes | Onboarding is a wizard with GSTIN lookup and state cross-checks. A bare PATCH could reach a state the UI cannot produce. |
| AI parse / transcribe | Costs money per call. |
| GSTIN lookup | Paid third-party quota. |
| API key management | UI only, so a leaked key cannot mint more keys. |
| Credit notes | Cancelling a *paid* invoice needs one under GST. Out of scope. |
| OAuth | Planned. API keys first. |
