
# Invoice AI REST API: Base URL, Amounts & Responses

> Base URL, versioning, request format, the { data } response envelope, resource ID prefixes, and amount conventions for the Invoice AI REST API.

# API Overview

The Invoice AI REST API gives you programmatic access to every resource on the platform — invoices, clients, products, prices, and webhooks. It is a JSON API following conventional HTTP semantics: `GET` to read, `POST` to create, `PATCH` to update, `DELETE` to remove.

## Base URL

All endpoints are served from a single versioned base:

```text theme={null}
https://invoice.horizonpay.co/api/v1
```

Every path in this reference is relative to that base. For example, the invoice list endpoint is:

```text theme={null}
GET https://invoice.horizonpay.co/api/v1/invoices
```

## Versioning

The current version is **v1**, encoded in the URL path. When a breaking change is necessary, a new version prefix will be introduced (`/api/v2`) and the previous version will be supported for a migration window. Non-breaking additions — new optional fields, new optional query parameters, new resource types — may be made to an existing version at any time without notice.

<Tip>
  Subscribe to the changelog to be notified of new fields or deprecation
  timelines before they affect your integration.
</Tip>

## OpenAPI Specification

A machine-readable OpenAPI 3.1 spec is available without authentication:

```text theme={null}
GET https://invoice.horizonpay.co/api/v1/openapi.json
```

Use it to generate type-safe client SDKs, import into Postman or Insomnia, or feed into any OpenAPI-aware toolchain.

## Request Format

For any request that carries a body (`POST`, `PATCH`), set:

```http theme={null}
Content-Type: application/json
```

Send the body as a JSON object. Requests with a body but a missing or wrong `Content-Type` will be rejected with a `400` error.

### Idempotency

Mutating operations that could cause duplicate side effects — specifically `finalize` and `pay` — **require** an `Idempotency-Key` header. Other write endpoints accept but do not require one.

```http theme={null}
Idempotency-Key: <unique-string-per-logical-request>
```

Use a UUID v4 generated client-side. Retrying with the same key and the same body returns the original response without re-executing the operation. Retrying with the same key but a *different* body returns `409 Conflict`.

<Warning>
  `POST /invoices` also requires an `Idempotency-Key`. A retried create without
  one produces a second, duplicate draft that is indistinguishable from the
  first — you would have no way to target the correct invoice for a subsequent
  `finalize` call.
</Warning>

## Response Envelope

Every successful response wraps its payload in a top-level `data` field:

```json theme={null}
{
  "data": { ... }
}
```

List endpoints extend the envelope with a cursor for the next page:

```json theme={null}
{
  "data": [ ... ],
  "next_cursor": "eyJjcmVhdGVkQXQiOiIyMDI0LTAxLTE1VDEyOjAwOjAwLjAwMFoiLCJpZCI6ImluXzAxSFhZIn0"
}
```

### Example: Fetch an Invoice

**Request**

```bash theme={null}
curl https://invoice.horizonpay.co/api/v1/invoices/in_01HXYZ \
  -H "Authorization: Bearer inv_live_..."
```

**Response**

```json theme={null}
{
  "data": {
    "id": "in_01HXYZ",
    "object": "invoice",
    "status": "draft",
    "currency": "usd",
    "amount_due": 250000,
    "customer": "cus_01HABC",
    "created_at": "2024-06-01T09:00:00.000Z"
  }
}
```

<Note>
  Error responses are **not** wrapped in `data`. They use the
  `application/problem+json` format described in the
  [Errors](/api-reference/errors) reference.
</Note>

## Resource ID Prefixes

Every resource in Invoice AI uses a Stripe-style prefixed ID. The prefix tells you at a glance what type of object an ID refers to, which is useful when debugging logs or constructing URLs.

| Prefix   | Resource          | Example        |
| -------- | ----------------- | -------------- |
| `cus_`   | Customer / client | `cus_01HABC`   |
| `in_`    | Invoice           | `in_01HXYZ`    |
| `ii_`    | Invoice line item | `ii_01HDEF`    |
| `prod_`  | Product           | `prod_01HGHI`  |
| `price_` | Price             | `price_01HJKL` |

IDs are opaque strings. Do not parse or construct them — store and pass them back exactly as returned.

## Monetary Amounts

All monetary amounts are represented as **integers in the minor unit** of the relevant currency — cents for USD and EUR, pence for GBP, and so on.

| API value | Currency | Human amount |
| --------- | -------- | ------------ |
| `250000`  | `usd`    | \$2,500.00   |
| `9900`    | `usd`    | \$99.00      |
| `150`     | `gbp`    | £1.50        |
| `0`       | `eur`    | €0.00        |

<Warning>
  Never send or store amounts as floating-point numbers. Integer minor units
  avoid rounding errors that compound across line items and tax calculations.
  A value of `250000` is unambiguous; `2500.00` as a float is not.
</Warning>

Amounts appear in fields such as `amount_due`, `amount_paid`, `unit_amount`, and `subtotal`. All are integers.

## HTTP Methods and Status Codes

The API uses standard HTTP methods and status codes:

| Method   | Meaning                     |
| -------- | --------------------------- |
| `GET`    | Retrieve a resource or list |
| `POST`   | Create a resource           |
| `PATCH`  | Partially update a resource |
| `DELETE` | Delete a resource           |

Successful responses return one of:

| Status           | When                           |
| ---------------- | ------------------------------ |
| `200 OK`         | Successful read or update      |
| `201 Created`    | Resource created (`POST`)      |
| `204 No Content` | Successful delete with no body |

For error codes and their meanings, see the [Errors](/api-reference/errors) reference.
