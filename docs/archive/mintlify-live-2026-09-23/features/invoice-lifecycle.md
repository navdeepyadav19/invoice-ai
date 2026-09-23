
# Invoice Lifecycle: Draft to Paid or Void

> Understand every invoice status — draft, open, overdue, paid, and void — and how to move between them in the UI or via the API.

Every invoice moves through a defined set of statuses from the moment you create it to the moment it's settled or cancelled. Understanding the lifecycle helps you keep your records accurate and prevents unintended changes to invoices you've already sent.

## Status overview

| Status      | What it means                                                                           |
| ----------- | --------------------------------------------------------------------------------------- |
| **Draft**   | Being edited. No invoice number assigned. Can be freely modified.                       |
| **Open**    | Finalized and sent. Invoice number assigned. Awaiting payment.                          |
| **Overdue** | An open invoice whose due date has passed. Computed automatically — no action required. |
| **Paid**    | Payment has been received and recorded.                                                 |
| **Void**    | Cancelled. No further actions can be taken.                                             |

## Draft

When you create a new invoice, it starts in **draft** status. A draft has no invoice number yet and can be edited freely — client details, line items, amounts, due date, and notes are all changeable.

<Tip>
  Use the draft stage to build and review your invoice before committing it. Once you finalize, certain fields are frozen permanently.
</Tip>

## Finalize

Finalizing an invoice does two things:

1. Assigns a **sequential invoice number** in the format `PREFIX/FY/SEQUENCE` — for example, `INV/25-26/0001`. The prefix and financial year are derived from your settings; the sequence number increments automatically.
2. Moves the invoice to **open** status, making it ready to send to your client.

**In the UI:** Open the invoice and click **Finalize**.

**Via the API:**

```bash theme={null}
# Finalize — requires Idempotency-Key
curl -X POST https://invoice.horizonpay.co/api/v1/invoices/in_xxx/finalize \
  -H "Authorization: Bearer inv_live_..." \
  -H "Idempotency-Key: <unique-uuid>"
```

<Warning>
  The `Idempotency-Key` header is **required** when finalizing via the API. It prevents duplicate invoice numbers if your request is retried after a timeout. Use a fresh UUID for each distinct finalize operation; reuse the same key to safely retry the same operation.
</Warning>

### Frozen snapshots

At the moment of finalization, Invoice AI takes a snapshot of your business details and the client's details. These snapshots are stored permanently on the invoice — they **will not change** even if you later update your profile, address, tax ID, or the client's information.

This means the invoice you sent always reflects exactly what was agreed at the time, which is important for compliance and audit purposes.

## Mark as paid

Once you've received payment, mark the invoice as paid to close it out.

**In the UI:** Open the open invoice and click **Mark as paid**.

**Via the API:**

```bash theme={null}
# Mark paid — requires Idempotency-Key
curl -X POST https://invoice.horizonpay.co/api/v1/invoices/in_xxx/pay \
  -H "Authorization: Bearer inv_live_..." \
  -H "Idempotency-Key: <unique-uuid>"
```

<Note>
  Like finalize, the pay endpoint requires an `Idempotency-Key` to prevent the invoice from being double-marked as paid on a network retry.
</Note>

## Overdue

An open invoice becomes **overdue** automatically once its due date has passed. There is nothing to configure or trigger — Invoice AI computes overdue status from the due date at display time.

Because overdue is derived rather than stored, it stays accurate without any scheduled jobs or manual updates. The invoice remains in open status internally; overdue is a display-layer label.

## Void

Voiding cancels an invoice permanently. You can optionally provide a reason, which is stored on the invoice record for your reference. In the API response, the stored reason is returned in the `void_reason` field.

**In the UI:** Open the invoice and click **Void**, then enter an optional reason.

**Via the API:**

```bash theme={null}
# Void — optional reason in request body
curl -X POST https://invoice.horizonpay.co/api/v1/invoices/in_xxx/void \
  -H "Authorization: Bearer inv_live_..." \
  -H "Content-Type: application/json" \
  -d '{"reason": "Client cancelled the project"}'
```

The voided invoice object returned by the API includes a `void_reason` field containing the reason you supplied (or `null` if none was given).

<Warning>
  Voiding is **irreversible**. A voided invoice cannot be re-opened, edited, or paid. If you need to bill for the same work again, create a new invoice.
</Warning>

## Allowed transitions

Not every status change is valid. The table below shows which transitions Invoice AI permits:

| From  | To   | Action                 |
| ----- | ---- | ---------------------- |
| Draft | Open | Finalize               |
| Open  | Paid | Mark as paid           |
| Open  | Void | Void                   |
| Draft | Void | Void                   |
| Paid  | —    | No further transitions |
| Void  | —    | No further transitions |

## API idempotency reference

Both `finalize` and `pay` are non-idempotent by default — retrying them without a key could assign a second invoice number or double-record a payment. The `Idempotency-Key` header makes these operations safe to retry:

* Use a **UUID v4** generated once per logical operation.
* If the first request succeeds, repeating it with the same key returns the original response without side effects.
* If the first request times out or errors, retry with the **same key** to pick up where you left off.

```text theme={null}
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
```

The `void` endpoint does not require an idempotency key because voiding is naturally idempotent — voiding an already-voided invoice is a no-op.
