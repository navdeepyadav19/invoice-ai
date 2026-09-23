
# Invoice AI: Professional Invoicing for Freelancers

> Invoice AI helps freelancers and small businesses create professional invoices, handle tax, generate PDFs, and get paid — with or without an account.

Invoice AI gets you from blank screen to a sent invoice in under a minute. Enter your client's name, describe what you did, set a rate — Invoice AI calculates the tax split, assigns a sequential invoice number, and hands you a PDF and a private shareable link. You can start immediately as a guest with no signup required, and everything you create travels with you when you create an account later.

## What you can do with Invoice AI

<CardGroup cols={3}>
  <Card title="Create invoices in seconds" icon="file-invoice">
    Fill in a client, add line items with individual tax rates, and Invoice AI handles all the arithmetic — totals, tax splits, and amount-in-words.
  </Card>

  <Card title="Get the right tax split" icon="calculator">
    Each line item carries its own tax rate. You set the percentage; Invoice AI computes the exact amounts in integer minor units so nothing rounds the wrong way.
  </Card>

  <Card title="Audit-safe numbering" icon="list-ol">
    Invoice numbers are assigned only when you finalize and send — abandoned drafts never leave gaps in your sequence.
  </Card>

  <Card title="PDF and shareable link" icon="link">
    Every invoice gets a clean PDF export and a private link your client can open in any browser — paste it into email, WhatsApp, or anywhere else.
  </Card>

  <Card title="AI invoice creation" icon="wand-magic-sparkles">
    Type or dictate what you're billing for — "Invoice Acme \$45,000 for brand design" — and the AI parses it into a ready-to-review invoice form.
  </Card>

  <Card title="REST API & webhooks" icon="code">
    Automate your billing workflows with a Stripe-shaped REST API. Use scoped API keys, cursor pagination, and webhooks to connect Invoice AI to your own tools.
  </Card>
</CardGroup>

## Where to go next

<CardGroup cols={2}>
  <Card title="Quickstart" icon="rocket" href="/quickstart">
    Create your first invoice, generate an API key, and make your first API call in five steps.
  </Card>

  <Card title="API Reference" icon="book-open" href="/api-reference/overview">
    Full reference for all REST endpoints — invoices, customers, products, prices, and webhooks.
  </Card>

  <Card title="AI Invoice Creation" icon="wand-magic-sparkles" href="/features/ai-invoice-creation">
    Let the AI parse a natural-language description into a complete invoice draft for you to review and confirm.
  </Card>

  <Card title="Webhooks" icon="bolt" href="/api-reference/webhooks/overview">
    Subscribe to invoice lifecycle events — created, finalized, viewed, paid, voided — and trigger your own workflows in real time.
  </Card>
</CardGroup>

## Key concepts

**Guest mode** — You don't need to create an account to raise an invoice. Clicking **Create an invoice** signs you in anonymously so you can start immediately. Your data is kept for 30 days. When you're ready to keep your work permanently, you can claim your account by adding an email and password — your invoices stay exactly where they are.

**Invoice lifecycle** — An invoice moves through these statuses:

| Status    | What it means                                                                 |
| --------- | ----------------------------------------------------------------------------- |
| `draft`   | Being edited; no invoice number assigned yet.                                 |
| `open`    | Finalized and sent to a client; awaiting payment.                             |
| `overdue` | Open past its due date (derived from the due date — no nightly job required). |
| `paid`    | Marked as paid.                                                               |
| `void`    | Cancelled; preserved in your records.                                         |

**Amounts are integer minor units** — All monetary values in the API are integers representing the smallest unit of the currency (cents, pence, paisa, etc.). For example, `250000` represents \$2,500.00. This eliminates floating-point rounding errors across every calculation.

**Stripe-shaped API** — If you've used Stripe's API, Invoice AI's REST API will feel immediately familiar: `cus_…` / `in_…` / `ii_…` resource IDs, Bearer token authentication, cursor pagination, `{ data }` response envelopes, and idempotency keys on writes.

<Note>
  Invoice AI is live at [https://invoice.horizonpay.co](https://invoice.horizonpay.co). The REST API base URL is `https://invoice.horizonpay.co/api/v1`.
</Note>
