# Invoice-AI API docs (Mintlify)

Source for the developer docs site at **docs.horizonpay.co**, built with
[Mintlify](https://mintlify.com). Everything the site needs lives in this folder.

```
api-docs/
├── docs.json                 # site config: theme, colors, navbar, navigation, API playground
├── openapi.json              # GENERATED — the API reference is built from this. Never hand-edit.
├── introduction.mdx …        # "Get started" tab pages
├── api-reference/            # "API reference" tab overview page
├── changelog.mdx
├── logo/ favicon.svg         # branding
└── .mintignore               # keeps this README out of the published site
```

## Run locally

```bash
cd api-docs
npx mint dev            # preview at http://localhost:3000
```

Before pushing, check the build and links:

```bash
cd api-docs
npx mint validate       # strict build check, fails on warnings or errors
npx mint broken-links   # internal link check
```

## The OpenAPI document is generated

`api-docs/openapi.json` is generated from the server's own schemas in
`lib/api/openapi.ts`, the same document served live at
`https://invoice.horizonpay.co/api/v1/openapi.json`. Regenerate it from the
repository root after any API change:

```bash
pnpm openapi:gen
```

**Never edit `openapi.json` by hand.** Change `lib/api/openapi.ts` (or the zod
schemas in `lib/validators.ts`) and regenerate. The "Endpoints" group in
`docs.json` points at this file with no page list, so every operation in the
spec gets its own page automatically, grouped by tag. New endpoints appear
without touching `docs.json`.

The hand-written guides (`*.mdx`) describe behaviour in `lib/api/*`,
`lib/services/*`, `lib/webhooks/*` and `lib/auth/scopes.ts`. If you change
rate limits, scopes, error codes, idempotency rules, webhook events or the
retry schedule, update the matching page too.

## Deploy

Deployment is handled by the **Mintlify GitHub app**. There's no CI step in
this repo.

1. In the Mintlify dashboard, install the GitHub app on
   `navdeepyadav19/invoice-ai`.
2. In **Git settings**, choose the deployment branch (`main`), turn on the
   **monorepo** toggle, and set the docs path to `api-docs` (no leading or
   trailing slash).
3. Add the custom domain `docs.horizonpay.co` in the dashboard (or run
   `npx mint add-domain docs.horizonpay.co`), then create the DNS `CNAME`
   record the dashboard shows.

After that, every push to the deployment branch that touches `api-docs/`
triggers a new deployment.
