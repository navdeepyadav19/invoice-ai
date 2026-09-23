
# Download PDF and Share Invoice Links

> Download a professional PDF of any finalized invoice or share a secure public link your client can open without logging in.

Once you finalize an invoice, Invoice AI gives you two ways to get it in front of your client: a downloadable PDF and a shareable public link that anyone can open in a browser — no account required.

## Public invoice link

Every finalized invoice has a **secure public URL** that you can share directly with your client. The link is generated at finalization and is tied to a unique, unguessable token stored in the `public_url_token` field of the invoice.

Anyone with the link can:

* View the formatted invoice in their browser
* Download the PDF from the invoice page

No login, no account creation, and no sensitive data beyond the invoice itself is exposed.

<Note>
  The public link is only available after finalization. Draft invoices don't have a shareable URL because their content can still change.
</Note>

### Find the link in the UI

Open any finalized invoice from your dashboard. The shareable link appears in the invoice view — click the copy icon to copy it to your clipboard, then paste it into an email, message, or wherever you communicate with your client.

### Get the link via the API

When you retrieve an invoice object through the API, the `public_url_token` field is included in the response. Construct the full URL as:

```text theme={null}
https://invoice.horizonpay.co/i/<public_url_token>
```

```json theme={null}
{
  "id": "in_xxx",
  "status": "open",
  "public_url_token": "tok_abc123...",
  ...
}
```

<Tip>
  Store the `public_url_token` in your own system if you need to resurface the link later — you won't have to make an extra API call to reconstruct it.
</Tip>

## Download a PDF

### From the invoice view

Open the invoice in your dashboard and click **Download PDF**. The PDF is generated on demand and downloads immediately to your device.

### Via the API

Use the dedicated PDF endpoint to download the invoice as a PDF file programmatically:

```bash theme={null}
curl -X GET https://invoice.horizonpay.co/api/v1/invoices/in_xxx/pdf \
  -H "Authorization: Bearer inv_live_..." \
  --output invoice.pdf
```

The endpoint returns the PDF with a `Content-Type: application/pdf` header. Use `--output` (curl) or the equivalent in your HTTP client to write it to disk.

<Note>
  PDF generation requires the invoice to be finalized. Calling the PDF endpoint on a draft invoice returns a `400` error.
</Note>

## What the PDF contains

The generated PDF includes:

* Your business name, address, and tax ID (from the snapshot taken at finalization)
* The client's name and address (also from the finalization snapshot)
* Invoice number, issue date, and due date
* All line items with descriptions, quantities, unit prices, and tax rates
* Subtotal, tax amount, and total
* Your payment instructions and any notes you added

Because the PDF is built from the finalization snapshot, it always matches what was agreed at the time — even if you've updated your business profile since.

## Sharing with clients

The recommended flow for getting a finalized invoice to a client is:

<Steps>
  <Step title="Finalize the invoice">
    From the invoice builder, click **Finalize**. Invoice AI assigns an invoice number and generates the public URL.
  </Step>

  <Step title="Copy the public link">
    Click the copy icon next to the shareable link in the invoice view. The link is ready to send.
  </Step>

  <Step title="Send the link to your client">
    Paste the link into your preferred channel — email, Slack, WhatsApp, or any other messaging tool. Your client clicks the link to view and download the invoice directly.
  </Step>
</Steps>

<Tip>
  If email delivery is enabled for your instance, you can use the built-in **Email it** button instead of manually copying the link. See [Emailing Invoices](/features/emailing-invoices) for details.
</Tip>
