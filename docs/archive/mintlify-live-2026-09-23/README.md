# Archive: live docs.horizonpay.co pages (2026-09-23)

Snapshot of the pages that were live on https://docs.horizonpay.co on 2026-09-23,
before the site was switched to the `api-docs/` folder of this repo.

Most of these pages were written in Mintlify's web editor and were not in any
repository (the Mintlify project was attached to `navdeepyadav19/mintlify-docs`).
They are kept here in case we later build an end-user help centre.

- Source: `https://docs.horizonpay.co/<path>.md` (Mintlify's Markdown export), fetched read-only with curl.
- Pages: index, introduction, quickstart, account-setup, api-reference/overview,
  concepts/{customers,invoices,products-and-prices},
  features/{ai-invoice-creation,emailing-invoices,invoice-lifecycle,pdf-and-sharing},
  settings/{api-keys,business-profile,webhooks}.
- The "Documentation Index" banner Mintlify adds to each export was stripped. Content is otherwise
  unedited, so MDX components (`<Steps>`, `<Card>` ...) appear as-is. Not verified against the current product.
