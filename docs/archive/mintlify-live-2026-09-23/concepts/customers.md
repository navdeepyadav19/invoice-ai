
# Customers — Fields, Archiving and Invoice Snapshots

> Understand how Invoice AI models customers: the fields on a customer record, how archiving works, and how customers link to invoices.

A customer in Invoice AI represents the person or business you bill. Every invoice is associated with one customer, and Invoice AI stores their details so you can reuse them without retyping on each new invoice.

***

## Customer object overview

Every customer has a unique identifier that begins with `cus_` (for example, `cus_ABcd1234EFgh5678IJkl9012`). Use this ID in API calls to reference the customer on an invoice, retrieve their record, or update their details.

### Fields

| Field     | Type           | Required | Description                                                                                        |
| --------- | -------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `id`      | string         | —        | Unique customer ID (`cus_…`). Assigned by Invoice AI                                               |
| `name`    | string         | ✅        | Full name or company name                                                                          |
| `email`   | string \| null |          | Billing email address                                                                              |
| `phone`   | string \| null |          | Contact phone number                                                                               |
| `tax_id`  | string \| null |          | Tax identifier — free-form text. Accepts VAT numbers, GST numbers, EINs, ABNs, or any local format |
| `address` | object         |          | Billing address (see below)                                                                        |
| `deleted` | boolean        | —        | `true` if this customer has been archived                                                          |
| `created` | string         | —        | ISO timestamp when the customer record was created                                                 |

### Address fields

The `address` object on a customer contains the following fields:

| Field         | Description                                                        |
| ------------- | ------------------------------------------------------------------ |
| `line1`       | Street address, first line                                         |
| `line2`       | Apartment, suite, unit number (optional)                           |
| `city`        | City                                                               |
| `state`       | State, province, or region                                         |
| `postal_code` | Postcode or ZIP code                                               |
| `country`     | Two-letter ISO 3166-1 alpha-2 country code (e.g. `US`, `GB`, `IN`) |

All address fields are optional. You can store as much or as little detail as you need.

<Tip>
  The `tax_id` field is free-form text and is not validated against any specific format. Enter whatever identifier your client uses — GSTIN, VAT number, EIN, ABN, or anything else.
</Tip>

***

## How customers relate to invoices

Every invoice points to a customer record by its `cus_…` ID. When you finalize an invoice, Invoice AI captures a **snapshot** of the customer's current details and stores it permanently with the invoice. This means:

* You can update a customer's address, email, or name at any time without affecting past invoices.
* Every finalized invoice accurately reflects what the customer's details were when it was issued.
* Archiving a customer does not alter or remove the invoices already associated with them.

***

## Archiving customers (soft delete)

Invoice AI does not permanently delete customers. Instead, it **archives** them. Archived customers are hidden from the default customer list but remain accessible so that historical invoices can still reference them correctly.

### Why no permanent delete?

Issued invoices must continue to name who they were billed to for as long as they exist. Permanently deleting a customer would break that link and compromise your records. Archiving keeps the link intact while removing the customer from your active list.

### Listing archived customers

By default, listing customers excludes archived records. To include archived customers in a list response, pass `include_deleted=true`:

```http theme={null}
GET /v1/customers?include_deleted=true
```

### Identifying archived customers

An archived customer has `"deleted": true` in the API response. Active customers have `"deleted": false`.

```json theme={null}
{
  "id": "cus_ABcd1234EFgh5678IJkl9012",
  "object": "customer",
  "name": "Acme Corporation",
  "email": "billing@acme.example",
  "deleted": true,
  "created": "2024-11-15T10:30:00Z"
}
```

<Note>
  Archiving is idempotent. If you archive a customer that is already archived, the request succeeds and the customer's record is unchanged. This means you can safely retry archive requests without risk.
</Note>

### Restoring an archived customer

You can un-archive a customer at any time. Once restored, the customer appears in the default list again and can be associated with new invoices.

***

## Customer creation: explicit vs. automatic

You can manage customers in two ways:

**Explicit creation via the API or app** — Create the customer record first, then reference it by `cus_…` ID when creating invoices. This is the recommended approach for integrations that sync a CRM or billing system.

**Automatic creation from invoice drafts** — When you save an invoice draft through the app, Invoice AI creates or updates a customer record automatically from the billing details you entered. This is the default behaviour in the invoice builder.

<Note>
  When you link an invoice to a saved customer by their `cus_…` ID, Invoice AI uses their record as-is and never overwrites it. The invoice's snapshot captures the customer's details at that moment. If you edit the customer later, the invoice snapshot remains unchanged.
</Note>
