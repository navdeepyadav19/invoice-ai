# Security policy

## Supported versions

Only `main` and the live site it deploys to, <https://invoice.horizonpay.co>,
get security fixes. There are no release branches. If you run your own instance,
update to the latest `main`.

## Reporting a vulnerability

Report privately through GitHub:
**[Report a vulnerability](https://github.com/navdeepyadav19/invoice-ai/security/advisories/new)**
(the repo's **Security** tab → **Report a vulnerability**). Only the maintainer
can see the report.

Please don't open a public issue, pull request or discussion for a security
problem.

Include what you can of:

- what an attacker can do, and what they need first (an account, an API key, a
  share link)
- the steps or requests that show it, with any keys or secrets redacted
- the affected route, API endpoint, or file

This is a one-maintainer project. Expect an acknowledgement within a few days;
the fix and an advisory follow once it's confirmed. Tell me if you want to be
credited.

## What's in scope

Things that matter most here:

- One account reading or changing another account's data — invoices,
  customers, products, API keys, webhook endpoints. Tenant isolation is enforced
  by Postgres row-level security (`db/migrations/`, `lib/db/scoped.ts`), so a
  bypass of it is the most serious class of bug.
- Authentication: sign-in, sessions, password reset, email verification, the
  CLI device login (`/api/cli/*`).
- The public API: API-key handling, scopes, webhook signing.
- Public invoice links (`/i/<token>`) exposing more than the one invoice.
- Secrets committed to this repository or its history.

Out of scope: the SDKs and CLI (report those on
[invoice-ai-sdk](https://github.com/navdeepyadav19/invoice-ai-sdk/security/advisories/new)),
vulnerabilities in Vercel, Neon or Resend themselves, volumetric denial of
service, and missing hardening headers with no demonstrated impact.

## Testing on the live site

Use accounts you created yourself. Don't access other people's data, don't
send email to addresses you don't own, and don't run automated scanners at a
volume that degrades the service. Good-faith research within these limits is
welcome.
