
# Quickstart: Create Your First Invoice with Invoice AI

> Set up your business profile, create your first invoice in the UI, generate a scoped API key, and list invoices via the REST API — all in under 10 minutes.

You'll go from zero to a sent invoice and a working API call in five steps. No prior setup is required — you can start as a guest and add an account at any point along the way.

<Steps>
  <Step title="Open the app and sign in">
    Go to [https://invoice.horizonpay.co](https://invoice.horizonpay.co).

    You have two ways to get started:

    * **Start immediately as a guest** — Click **Create an invoice** on the landing page. Invoice AI signs you in anonymously, no email required. Your data is kept for 30 days.
    * **Create a full account** — Click **Create account**, enter your name, email, and a password of at least 8 characters, then confirm your email address from the link Invoice AI sends you.

    <Tip>
      Guest mode is the fastest path to your first invoice. You can add an email and password later to make your account permanent — all your invoices transfer automatically.
    </Tip>
  </Step>

  <Step title="Set up your business profile">
    If you signed up with an account, the onboarding wizard opens automatically. Complete the two steps:

    **Step 1 — Business details**

    Invoice AI pre-selects your country from your IP address. You can change it at any time. Fill in:

    | Field                             | Required?                          |
    | --------------------------------- | ---------------------------------- |
    | Business name                     | Yes                                |
    | Country                           | Yes                                |
    | Currency                          | Yes (follows the country you pick) |
    | Address                           | Yes                                |
    | Tax ID (VAT, EIN, GST, ABN, etc.) | Optional                           |

    **Step 2 — Payment details**

    Add your bank account name, account number, and routing code so your clients see how to pay at the bottom of every invoice. This step is skippable — you can fill it in later under **Settings → Business**.

    <Note>
      If you started as a guest, Invoice AI lets you fill in your business details directly in the invoice builder the first time you create an invoice. The onboarding wizard only appears for email-based accounts.
    </Note>
  </Step>

  <Step title="Create your first invoice">
    From the dashboard, click **New invoice** (or navigate to **Invoices → New**).

    1. **Add a client** — Type your client's name. You can also add their email, address, and tax ID.
    2. **Set the invoice date and due date** — Invoice AI defaults to today's date.
    3. **Add line items** — For each item, enter a description, quantity, and rate. Add a tax rate per line if applicable — Invoice AI calculates the split automatically.
    4. **Review the totals** — The live preview updates as you type. Check the subtotal, tax amount, and grand total.
    5. **Save or send** — Click **Save draft** to keep editing later, or **Finalize & send** to assign an invoice number and share it with your client.

    <Tip>
      Click **Use AI** above the form to describe your invoice in plain language — for example, *"Invoice Acme Corp \$12,000 for UX design, 18% tax"*. Review the AI-generated summary, then click **Fill this in** to populate the form. Nothing is saved until you confirm.
    </Tip>

    Once finalized, Invoice AI assigns the next sequential invoice number and gives you a shareable link and a PDF download. Send the link directly to your client or email it from within the app.
  </Step>

  <Step title="Generate an API key">
    API keys let you automate invoice creation, sync client data, and build integrations — all without touching the UI.

    1. Go to **Settings → API Keys**.
    2. Click **New API key**.
    3. Give the key a name (for example, *"Zapier integration"* or *"billing script"*).
    4. Select the scopes your integration needs:

    | Scope               | What it grants                                  |
    | ------------------- | ----------------------------------------------- |
    | `invoices:read`     | List and read invoices, including PDFs          |
    | `invoices:write`    | Create, edit, and delete drafts                 |
    | `invoices:finalize` | Finalize invoices and void them                 |
    | `invoices:send`     | Email invoices to clients                       |
    | `clients:read`      | List and read clients                           |
    | `clients:write`     | Create, update, and archive clients             |
    | `products:read`     | List and read products and prices               |
    | `products:write`    | Create, update, and archive products and prices |
    | `payments:write`    | Mark invoices as paid                           |
    | `webhooks:manage`   | Manage webhook endpoints                        |

    5. Click **Create**. Copy the key — it starts with `inv_live_` and is shown **only once**.

    <Warning>
      Store your API key securely. Invoice AI never displays the full key again after creation. If you lose it, revoke it and create a new one. A leaked key cannot create additional keys — key management is only possible in the UI.
    </Warning>

    <Note>
      Guest accounts cannot hold API keys. If you see a message prompting you to add an email and password, follow the steps in [Account Setup → Claiming a guest account](/account-setup#claiming-a-guest-account) first.
    </Note>
  </Step>

  <Step title="Make your first API call">
    With your key in hand, make a request to the invoices endpoint to confirm everything is working.

    ```bash theme={null}
    curl https://invoice.horizonpay.co/api/v1/invoices \
      -H "Authorization: Bearer inv_live_..."
    ```

    A successful response returns a `{ data }` envelope containing your invoice list:

    ```json theme={null}
    {
      "data": [
        {
          "id": "in_01abc...",
          "status": "open",
          "amount_due": 1440000,
          "currency": "USD",
          "customer": "cus_01xyz...",
          "created": "2025-06-15"
        }
      ],
      "next_cursor": null
    }
    ```

    <Note>
      All monetary values are **integer minor units**. In the example above, `1440000` is \$14,400.00. Divide by 100 to get the major-currency amount.
    </Note>

    You can filter results with query parameters:

    ```bash theme={null}
    # Filter by status
    curl "https://invoice.horizonpay.co/api/v1/invoices?status=open" \
      -H "Authorization: Bearer inv_live_..."

    # Filter by date range
    curl "https://invoice.horizonpay.co/api/v1/invoices?from=2025-01-01&to=2025-06-30" \
      -H "Authorization: Bearer inv_live_..."

    # Paginate using a cursor from the previous response
    curl "https://invoice.horizonpay.co/api/v1/invoices?cursor=<next_cursor>" \
      -H "Authorization: Bearer inv_live_..."
    ```

    Available status filters: `draft`, `open`, `paid`, `overdue`, `void`.
  </Step>
</Steps>

## What's next

<CardGroup cols={2}>
  <Card title="API Reference" icon="book-open" href="/api-reference/overview">
    Explore all endpoints: invoices, customers, products, prices, and webhooks — with full request and response schemas.
  </Card>

  <Card title="Account Setup" icon="user-gear" href="/account-setup">
    Learn how to claim a guest account, reset your password, and complete the onboarding wizard.
  </Card>
</CardGroup>
