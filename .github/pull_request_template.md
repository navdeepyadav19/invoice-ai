## What this changes

<!-- One or two sentences: what does this branch add or fix, and why? -->

## How to verify

<!-- Steps a reviewer can follow on the Vercel preview deployment linked below. -->

## Review checklist

- [ ] CI is green: lint, typecheck, unit tests, API docs up to date, build
- [ ] Preview deployment opened and the change works there
- [ ] New logic has unit tests (`lib/**/*.test.ts`)
- [ ] No secrets or `.env` values committed
- [ ] Database changes ship as a new file in `db/migrations/` (applied with `pnpm db:migrate`), never an edit to an old one
- [ ] Totals still reconcile: subtotal − discounts + tax = total, in integer minor units (`lib/tax.ts`, `lib/money.ts`)
- [ ] API contract changes regenerated: `pnpm openapi:gen && pnpm postman:gen`
