
# Email Invoices Directly to Clients

> Send finalized invoices straight to your client's inbox with one click — includes a link to the shareable invoice page and PDF download.

Invoice AI can send finalized invoices directly to your client's email address. The email includes a link to the invoice's public page, where the client can view the full invoice and download the PDF — without needing an account.

<Note>
  Email delivery is optional. Invoice AI works fully without it — you can always share the public invoice link manually. The **Email it** button only appears when email delivery has been configured for your instance by your administrator.
</Note>

## Prerequisites

Before you can email invoices, email delivery must be enabled for your Invoice AI instance. This requires a verified sending domain to be configured by your administrator. If the **Email it** button is not visible on finalized invoices, reach out to your administrator to have email delivery set up.

## Send an invoice by email

Once email delivery is configured, the **Email it** button appears on every finalized invoice.

<Steps>
  <Step title="Finalize the invoice">
    If you haven't already, finalize the invoice from the builder. The **Email it** button is only available on invoices with **open**, **overdue**, or **paid** status — drafts cannot be emailed.
  </Step>

  <Step title="Click 'Email it'">
    Open the invoice and click **Email it**. Invoice AI sends the email to the address stored on the client record associated with that invoice.
  </Step>

  <Step title="Confirm delivery">
    The button updates to confirm the email was sent. If delivery fails, an error message is shown in the UI.
  </Step>
</Steps>

<Tip>
  Make sure your client record has an accurate email address before finalizing. The email address is taken from the client snapshot at finalization — if the client's email has changed, update it and create a new invoice rather than editing a finalized one.
</Tip>

## What the email contains

The email your client receives includes:

* A greeting addressed to the client name
* The invoice number and total amount due
* The due date
* A **View Invoice** button linking to the public invoice page
* Your business name as the sender display name

From the invoice page, your client can read the full line-item breakdown and download the PDF.

## Webhook events

Invoice AI fires webhook events so you can track email delivery in your own systems:

| Event                  | When it fires                                        |
| ---------------------- | ---------------------------------------------------- |
| `invoice.emailed`      | The email was accepted for delivery.                 |
| `invoice.email_failed` | The email could not be sent due to a delivery error. |

Use these events to trigger follow-up actions — for example, logging delivery status, retrying after a failure, or notifying your team when a client hasn't received their invoice.

```json theme={null}
// invoice.emailed payload (example)
{
  "event": "invoice.emailed",
  "invoice_id": "in_xxx",
  "client_email": "client@example.com",
  "sent_at": "2025-06-01T10:32:00Z"
}
```

```json theme={null}
// invoice.email_failed payload (example)
{
  "event": "invoice.email_failed",
  "invoice_id": "in_xxx",
  "client_email": "client@example.com",
  "error": "Invalid recipient address",
  "failed_at": "2025-06-01T10:32:05Z"
}
```

<Note>
  `invoice.emailed` confirms that the email was accepted by your email delivery provider — it does not guarantee the email reached the client's inbox. Delivery to the inbox depends on your sending domain's reputation and the client's email provider.
</Note>

## Troubleshooting

**The "Email it" button isn't showing.**
Email delivery has not been enabled for your instance. Contact your administrator to configure a verified sending domain and enable the feature.

**The email was sent but my client didn't receive it.**
Ask your client to check their spam or junk folder. If the problem persists, your administrator may need to verify that the sending domain's DNS records are correctly configured.

**I received an `invoice.email_failed` webhook.**
Check that the client's email address is valid and correctly entered on the client record. If the address looks correct, contact your administrator — the email delivery integration may need attention.
