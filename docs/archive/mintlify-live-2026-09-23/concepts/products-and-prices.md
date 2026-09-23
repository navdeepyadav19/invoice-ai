
# Products & Prices — Catalog Model and Invoice Lines

> Learn how Invoice AI's product catalog works: products, one-time and recurring prices, and how to attach catalog items to invoice line items.

Invoice AI's catalog gives you a reusable library of the things you sell. Instead of retyping descriptions, rates, and tax rates on every invoice, you define them once as **products** and **prices**, then reference them on any invoice line.

***

## The catalog model

The catalog uses a two-level hierarchy:

* **Product** — What you are selling. A name, description, and optional images. Think of it as the item in your shop window.
* **Price** — How you charge for it. An amount in a specific currency, a tax rate, and either a one-time charge or a recurring billing interval. One product can have multiple prices (for example, a monthly plan and an annual plan, or USD and EUR variants).

This mirrors the Stripe catalog model, so integrations built around Stripe's products and prices map across naturally.

***

## Products

### Product fields

| Field         | Type           | Description                                                          |
| ------------- | -------------- | -------------------------------------------------------------------- |
| `id`          | string         | Unique product ID (`prod_…`)                                         |
| `name`        | string         | Product name (required, max 200 characters)                          |
| `description` | string \| null | Optional longer description                                          |
| `images`      | string\[]      | Up to 8 image URLs                                                   |
| `active`      | boolean        | Whether this product appears in catalog searches. Defaults to `true` |
| `created`     | string         | ISO timestamp                                                        |
| `updated`     | string         | ISO timestamp                                                        |

### Deactivating a product

Setting `active: false` on a product removes it from catalog searches. Existing invoice lines that already reference the product are not affected — the line's recorded values remain intact. Re-activate the product at any time by setting `active: true`.

***

## Prices

A price belongs to exactly one product. It specifies the amount to charge, the currency, how tax is applied, and whether this is a one-time or recurring charge.

### Price fields

| Field            | Type           | Description                                                                                                          |
| ---------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `id`             | string         | Unique price ID (`price_…`)                                                                                          |
| `product`        | string         | Parent product ID (`prod_…`)                                                                                         |
| `nickname`       | string \| null | Optional display label for this price (e.g. `"Monthly — USD"`). Shown in the dashboard and returned in API responses |
| `unit_amount`    | integer        | Amount per unit in **minor units** (e.g. `5000` = \$50.00)                                                           |
| `currency`       | string         | ISO 4217 currency code (e.g. `USD`, `EUR`, `GBP`)                                                                    |
| `type`           | string         | `one_time` or `recurring`                                                                                            |
| `recurring`      | object \| null | Present only when `type` is `recurring` (see below)                                                                  |
| `billing_scheme` | string         | Read-only. Always `per_unit` — Invoice AI charges per unit on every price                                            |
| `tax_rate`       | number         | Tax percentage applied to this price on invoice lines (0–100)                                                        |
| `active`         | boolean        | Whether this price appears in catalog searches. Defaults to `true`                                                   |

### The `recurring` object

When `type` is `recurring`, the price includes a `recurring` object:

| Field            | Type    | Description                                                                 |
| ---------------- | ------- | --------------------------------------------------------------------------- |
| `interval`       | string  | Billing interval: `day`, `week`, `month`, or `year`                         |
| `interval_count` | integer | How many intervals between charges (e.g. `3` with `month` = every 3 months) |

For `one_time` prices, `recurring` is `null`.

***

## One-time vs. recurring prices

### One-time (`type: "one_time"`)

A one-time price represents a single charge with no repeat. Use this for:

* Fixed-scope project fees
* Product sales
* One-off consulting engagements
* Setup fees

### Recurring (`type: "recurring"`)

A recurring price carries billing interval information — how often the charge repeats and how many intervals between each charge.

<Note>
  Recurring is a **data model** that lets you describe subscription-style pricing in your catalog. Invoice AI does not automatically generate invoices on a schedule — you create each invoice yourself (or via the API). The recurring data is informational and useful for integrations that manage their own billing logic.
</Note>

Common recurring configurations:

| Description    | `interval` | `interval_count` |
| -------------- | ---------- | ---------------- |
| Monthly        | `month`    | `1`              |
| Quarterly      | `month`    | `3`              |
| Every 6 months | `month`    | `6`              |
| Annual         | `year`     | `1`              |
| Weekly         | `week`     | `1`              |
| Every 2 weeks  | `week`     | `2`              |

***

## Creating a product and price

Here is how to create a product and then attach a price to it using the API.

### Step 1: Create a product

```bash theme={null}
curl -X POST https://invoice.horizonpay.co/v1/products \
  -H "Authorization: Bearer sk_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Brand Design Package",
    "description": "Full brand identity including logo, colour palette, and typography guide"
  }'
```

Response:

```json theme={null}
{
  "data": {
    "id": "prod_ABcd1234EFgh5678IJkl9012",
    "object": "product",
    "name": "Brand Design Package",
    "description": "Full brand identity including logo, colour palette, and typography guide",
    "images": [],
    "active": true,
    "created": "2025-04-01T09:00:00Z",
    "updated": "2025-04-01T09:00:00Z"
  }
}
```

### Step 2: Create a one-time price

```bash theme={null}
curl -X POST https://invoice.horizonpay.co/v1/prices \
  -H "Authorization: Bearer sk_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "prod_ABcd1234EFgh5678IJkl9012",
    "nickname": "Standard package — USD",
    "unit_amount": 250000,
    "currency": "USD",
    "type": "one_time",
    "tax_rate": 0
  }'
```

Response:

```json theme={null}
{
  "data": {
    "id": "price_XYz9876WVut5432SRqp1098",
    "object": "price",
    "product": "prod_ABcd1234EFgh5678IJkl9012",
    "nickname": "Standard package — USD",
    "unit_amount": 250000,
    "currency": "USD",
    "billing_scheme": "per_unit",
    "type": "one_time",
    "recurring": null,
    "tax_rate": 0,
    "active": true,
    "created": "2025-04-01T09:01:00Z"
  }
}
```

<Note>
  `unit_amount` is in minor units. `250000` represents \$2,500.00.
</Note>

### Step 3: Create a recurring price for the same product

```bash theme={null}
curl -X POST https://invoice.horizonpay.co/v1/prices \
  -H "Authorization: Bearer sk_live_your_api_key" \
  -H "Content-Type: application/json" \
  -d '{
    "product": "prod_ABcd1234EFgh5678IJkl9012",
    "nickname": "Monthly retainer — USD",
    "unit_amount": 75000,
    "currency": "USD",
    "type": "recurring",
    "recurring": {
      "interval": "month",
      "interval_count": 1
    },
    "tax_rate": 20
  }'
```

<Tip>
  One product can have as many prices as you need — different currencies, different intervals, different tax rates. Each price gets its own `price_…` ID.
</Tip>

***

## Using catalog prices on invoice lines

When you create or update an invoice draft, each line item can reference a catalog price by its `price_…` ID. Invoice AI then borrows the description (from the product name), the rate, and the tax rate from the price — you only need to specify the quantity.

```json theme={null}
{
  "customer": "cus_ABcd1234EFgh5678IJkl9012",
  "currency": "USD",
  "items": [
    {
      "price": "price_XYz9876WVut5432SRqp1098",
      "quantity": 1
    }
  ]
}
```

You can still override individual fields on a catalog line. For example, you can set a custom `description` or `discount_percent` even when a `price` ID is provided.

### Ad-hoc lines

If you don't reference a `price_…` ID, the line is **ad-hoc** and must include all values directly:

```json theme={null}
{
  "description": "Rush fee",
  "quantity": 1,
  "unit_amount": 10000,
  "tax_rate": 20
}
```

<Note>
  The price's currency must match the invoice's currency. If you create an invoice in `USD`, only prices denominated in `USD` can be attached to its lines.
</Note>

***

## Price and product IDs

Product and price IDs use a fixed prefix format:

| Resource | ID format                       | Example                          |
| -------- | ------------------------------- | -------------------------------- |
| Product  | `prod_` + 24 random characters  | `prod_ABcd1234EFgh5678IJkl9012`  |
| Price    | `price_` + 24 random characters | `price_ABcd1234EFgh5678IJkl9012` |

The different prefixes mean that pasting a product ID into a field that expects a price ID will fail with a clear error, rather than silently succeeding.

***

## Deactivating prices

Setting `active: false` on a price removes it from catalog searches but does not affect invoices already using it. You cannot modify the `type`, `unit_amount`, or `currency` of a price after creation — if you need to change these, create a new price and deactivate the old one.

<Warning>
  You cannot change a price from `one_time` to `recurring` or vice versa after it has been created. Create a new price with the correct type instead.
</Warning>
