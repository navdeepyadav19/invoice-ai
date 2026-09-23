
# Business Profile, Address & Invoice Numbering — Invoice AI

> Configure your legal name, address, tax ID, currency, payment details, and invoice numbering so every invoice reflects your business accurately.

Your business profile is the foundation of every invoice you send. The details you enter here appear on invoice PDFs, in your email templates, and in the invoices you deliver to clients. Keep this information current and accurate — incorrect legal names or tax IDs can create compliance problems in many jurisdictions.

To open your business profile, go to **Settings → Business**.

***

## Identity

| Field             | Required | Notes                                                                                                                                           |
| ----------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Legal name**    | ✅ Yes    | The registered name of your business. Minimum 2 characters.                                                                                     |
| **Trade name**    | No       | Your trading or "doing business as" name, if different from the legal name.                                                                     |
| **Business type** | No       | `Sole trader`, `Partnership`, `Limited company`, or `Other`.                                                                                    |
| **Country**       | ✅ Yes    | Sets the default tax and compliance context for your account.                                                                                   |
| **Currency**      | ✅ Yes    | Your default invoicing currency (3-letter ISO code, e.g. `USD`, `GBP`, `EUR`).                                                                  |
| **Tax ID**        | No       | Free-text field — enter whatever format applies to your jurisdiction: VAT number, EIN, GSTIN, ABN, and so on. No format validation is enforced. |

<Note>
  **Legal name** and **Country** are required before you can finalize and send your first invoice. Invoice AI will prompt you to complete them during onboarding if they are missing.
</Note>

### Business type values

Choose the option that best matches your legal structure:

* **Sole trader** — you operate as an individual and are personally liable.
* **Partnership** — two or more people share ownership and liability.
* **Limited company** — a separate legal entity (Ltd, LLC, Pty Ltd, GmbH, etc.).
* **Other** — use this for trusts, non-profits, cooperatives, or any structure not listed above.

***

## Address

Your business address prints on every invoice. All address fields except `address_line1` and `city` are optional, but providing a complete address improves credibility with clients and is required for tax-compliant invoices in most countries.

| Field                         | Required | Example             |
| ----------------------------- | -------- | ------------------- |
| **Address line 1**            | ✅ Yes    | `12 Harbour Street` |
| **Address line 2**            | No       | `Suite 400`         |
| **City**                      | ✅ Yes    | `Sydney`            |
| **Region / State / Province** | No       | `NSW`               |
| **Postal / ZIP code**         | No       | `2000`              |

***

## Contact details

| Field     | Notes                                                                                    |
| --------- | ---------------------------------------------------------------------------------------- |
| **Email** | A contact or billing email shown on invoices. Must be a valid email address if provided. |
| **Phone** | Any phone number format is accepted.                                                     |

<Tip>
  Use a dedicated billing email address (for example, `billing@yourcompany.com`) rather than a personal address. This makes it easy to filter client replies and payment notifications in one place.
</Tip>

***

## Branding

You can upload a **logo** and a **signature image** from the Business settings page. Both appear on your invoice PDFs.

* **Logo** — displayed in the header of every invoice PDF. Recommended: a square or landscape image at least 300 × 300 px in PNG or SVG format.
* **Signature** — an image of your handwritten signature, printed at the bottom of the invoice. PNG with a transparent background works best.

***

## Payment details

Go to **Settings → Bank** to configure the bank account information that appears in the payment section of your invoices.

| Field                     | Notes                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Bank name**             | The name of your bank or financial institution.                                                                                            |
| **Account name**          | The name on the account — usually your legal or trade name.                                                                                |
| **Account number**        | Your bank account number.                                                                                                                  |
| **Routing number**        | Your ABA routing number, BSB, sort code, or equivalent.                                                                                    |
| **Default payment terms** | Free text that prints in the "Terms" section of every new invoice (e.g., `Payment due within 30 days`). You can override this per invoice. |
| **Default notes**         | Free text printed in the "Notes" section of every new invoice (e.g., `Thank you for your business!`). You can override this per invoice.   |

<Warning>
  Invoice AI does **not** validate your account number or routing number. Double-check these values carefully before sending invoices — an error here means clients wire money to the wrong account.
</Warning>

***

## Invoice numbering

Go to **Settings → Business** and scroll to the **Invoice numbering** section to configure how Invoice AI generates invoice numbers.

| Field                   | Rules                                                                                                        | Example                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| **Invoice prefix**      | Letters, numbers, hyphens, and slashes only. Uppercase. Maximum 16 characters.                               | `INV`, `ACME-2025`, `US/NYC` |
| **Next invoice number** | A whole number between 1 and 999,999. Invoice AI increments this automatically after each finalized invoice. | `1001`                       |

Your invoice numbers are formatted as **`{PREFIX}-{NUMBER}`** — for example, with prefix `ACME` and next number `1001`, your first invoice is numbered `ACME-1001`.

<Steps>
  <Step title="Open numbering settings">
    Go to **Settings → Business** and scroll to the **Invoice numbering** section.
  </Step>

  <Step title="Set your prefix">
    Enter a prefix in the **Invoice prefix** field. Use uppercase letters, numbers, hyphens, or slashes. Keep it recognisable — clients will see this on every invoice.
  </Step>

  <Step title="Set the starting number">
    Enter the number you want your next invoice to carry in the **Next invoice number** field. If you are migrating from another system, set this to the number after your last issued invoice so there are no gaps.
  </Step>

  <Step title="Save">
    Click **Save**. The new sequence takes effect on your next finalized invoice.
  </Step>
</Steps>

<Warning>
  Once an invoice is finalized, its number is permanent and cannot be changed. Gaps in your invoice sequence (caused by voided invoices) are normal and expected — do **not** reuse a number.
</Warning>

***

## Frequently asked questions

<Accordion title="Can I use a different currency per invoice?">
  Yes. Your business profile currency is the **default** for new invoices. When you create an invoice you can choose a different currency for that specific invoice, provided the currency code is a valid 3-letter ISO code. The business default currency does not change.
</Accordion>

<Accordion title="Do I need a tax ID to use Invoice AI?">
  No. The **Tax ID** field is optional. If your business is not registered for VAT, GST, or any other tax scheme, simply leave it blank. If you are registered, enter your ID exactly as it should appear on your invoices — Invoice AI prints it verbatim without any formatting.
</Accordion>

<Accordion title="What happens if I change my invoice prefix mid-year?">
  Only new finalized invoices pick up the new prefix. Previously issued invoices keep the prefix they were assigned. If continuity matters for your accounting, coordinate the prefix change with the start of a new financial period.
</Accordion>

<Accordion title="Can I set different default terms for individual clients?">
  Default terms are set at the business level under **Settings → Bank**. You can override them per invoice in the invoice editor. Per-client defaults are not supported yet — use the invoice-level override in the meantime.
</Accordion>
