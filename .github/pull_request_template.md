## What this changes

<!-- One or two sentences: what does this branch add or fix, and why? -->

## How to verify

<!-- Steps a reviewer can follow on the Vercel preview deployment linked below. -->

## Review checklist

- [ ] CI is green: lint, typecheck, unit tests, build
- [ ] Preview deployment opened and the change works there
- [ ] New logic has unit tests (`lib/**/*.test.ts`)
- [ ] No secrets or `.env` values committed
- [ ] Database changes ship as a new file in `supabase/migrations/`, never an edit to an old one
- [ ] GST math still reconciles: taxable + tax + round-off = total
