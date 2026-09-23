
# API Keys — Create, Scope, and Revoke Tokens — Invoice AI

> Create scoped API keys to integrate Invoice AI with your apps and automations, understand available permissions, and keep credentials secure.

API keys let external applications — scripts, integrations, CI pipelines, or third-party tools — authenticate to the Invoice AI REST API on your behalf. Each key carries a set of **scopes** that define exactly what it is allowed to do, so you can grant the minimum access each integration needs.

To manage your keys, go to **Settings → API Keys**.

<Note>
  Guest accounts cannot create API keys. You must complete account setup and verify your email address before the **API Keys** page becomes available.
</Note>

***

## Key format

Every Invoice AI API key looks like this:

```
inv_live_ab12cd34_7Kf9QmXz2pR4vNt6LwYb8HsJ3dGc5eAu
└────────────────┘ └──────────────────────────────────┘
   public prefix              secret portion
   (stored & displayed)       (shown once, never stored)
```

* The `inv_live_` prefix is fixed and greppable — secret-scanning tools (including GitHub's) can detect it if you accidentally commit a key.
* The 8-character public ID after `inv_live_` is stored and displayed in your settings list so you can identify which key belongs to which integration.
* The 32-character secret is **shown only once** at creation. Invoice AI stores only a one-way hash of it.

***

## Creating an API key

<Steps>
  <Step title="Open API Keys settings">
    Go to **Settings → API Keys** and click **New API key**.
  </Step>

  <Step title="Name your key">
    Enter a descriptive name that identifies the integration or environment — for example, `Zapier production` or `CI invoice bot`. You cannot change the name after creation.
  </Step>

  <Step title="Choose scopes">
    Select one or more scopes from the list. Only grant the permissions the integration actually needs. You cannot add scopes to an existing key — create a new key if you need to widen access.
  </Step>

  <Step title="Set an expiry (optional)">
    Choose an expiry period if you want the key to stop working automatically. Leave blank for a key that remains valid until you revoke it.
  </Step>

  <Step title="Copy and store the key">
    After clicking **Create**, Invoice AI displays the full key **once**. Copy it immediately and store it in a password manager or secrets vault. You cannot retrieve it again.
  </Step>
</Steps>

<Warning>
  The full key is shown **only at creation time**. If you close or navigate away without copying it, you must revoke the key and create a new one. Invoice AI cannot recover or re-display a key's secret portion.
</Warning>

***

## Available scopes

Scopes follow a `resource:action` pattern. Grant only what each integration needs.

| Scope               | What it allows                                               |
| ------------------- | ------------------------------------------------------------ |
| `business:read`     | Read your business profile, tax ID and bank details          |
| `clients:read`      | List and read your clients                                   |
| `clients:write`     | Create, update and archive clients                           |
| `products:read`     | List and read products and prices                            |
| `products:write`    | Create, update and archive products and prices               |
| `invoices:read`     | List and read invoices, including PDFs                       |
| `invoices:write`    | Create, edit and delete draft invoices                       |
| `invoices:finalize` | Finalize invoices (assigns a permanent number) and void them |
| `invoices:send`     | Email invoices to your clients                               |
| `payments:write`    | Mark invoices as paid                                        |
| `webhooks:manage`   | Manage webhook endpoints                                     |

<Note>
  **`invoices:write` does not grant `invoices:finalize` or `invoices:send`.**
  Finalizing an invoice assigns a permanent number — a legally meaningful, irreversible action — so it requires its own explicit scope. Similarly, emailing a client costs money and is visible to a third party, so `invoices:send` must be granted separately.

  Credential management (creating or revoking API keys) is **never** a scope. It is only possible through the web UI, so a compromised key cannot mint additional keys or expand its own permissions.
</Note>

***

## Authenticating requests

Pass your API key in the `Authorization` header as a `Bearer` token:

```bash theme={null}
curl https://invoice.horizonpay.co/api/v1/invoices \
  -H "Authorization: Bearer inv_live_ab12cd34_7Kf9QmXz2pR4vNt6LwYb8HsJ3dGc5eAu"
```

A request with a missing, malformed, revoked, or expired key receives a `401 Unauthorized` response. A request with a valid key that lacks the required scope for the endpoint receives a `403 Forbidden` response.

***

## Revoking a key

You can revoke any key at any time from **Settings → API Keys**. Click the **Revoke** button next to the key you want to disable. Revocation is immediate and permanent — the key stops authenticating requests within seconds.

<Note>
  Revoking a key does **not** delete it from your settings list. The row is kept so the audit log can still attribute past API requests to the correct key. Revoked keys are clearly marked and cannot be re-activated. Create a new key if you need to restore access.
</Note>

***

## Security best practices

<Tip>
  Treat API keys like passwords. A key with `invoices:send` scope can email all of your clients; a key with `invoices:finalize` can permanently number and close invoices on your account.
</Tip>

**Never commit keys to source control.**

Even in a private repository, committed secrets are a serious risk. Use environment variables instead:

```bash theme={null}
# Set the key in your environment
export INVOICE_AI_API_KEY="inv_live_ab12cd34_..."

# Reference it from your code
curl https://invoice.horizonpay.co/api/v1/invoices \
  -H "Authorization: Bearer $INVOICE_AI_API_KEY"
```

In application code, read the key from the environment at runtime:

```javascript theme={null}
// Node.js example
const apiKey = process.env.INVOICE_AI_API_KEY;
if (!apiKey) throw new Error('INVOICE_AI_API_KEY is not set');
```

```python theme={null}
# Python example
import os
api_key = os.environ["INVOICE_AI_API_KEY"]
```

**Additional recommendations:**

* **Use one key per integration.** This limits the blast radius if a key leaks and lets you revoke a single integration without disrupting others.
* **Apply the principle of least privilege.** Give each key only the scopes it actually uses. A read-only reporting dashboard should never hold `invoices:finalize`.
* **Set expiry dates on short-lived integrations.** For one-off scripts or temporary access, set an expiry so the key stops working automatically without you having to remember to revoke it.
* **Rotate keys periodically.** Create a replacement key, update your integration, verify it works, then revoke the old key.
* **Store keys in a secrets manager.** Tools like AWS Secrets Manager, HashiCorp Vault, Doppler, or your platform's native secrets store (e.g., GitHub Actions secrets, Vercel environment variables) are safer than `.env` files on disk.

***

## Frequently asked questions

<Accordion title="Can I see the full key again after creation?">
  No. Invoice AI stores only a one-way hash of the secret portion. If you lose the key, revoke it from Settings → API Keys and create a new one.
</Accordion>

<Accordion title="Can I add scopes to an existing key?">
  No. Scopes are fixed at creation time. To gain additional permissions, create a new key with the required scopes, update your integration, and revoke the old key.
</Accordion>

<Accordion title="What happens when a key expires?">
  Requests made with an expired key receive a `401 Unauthorized` response with a reason of `expired`. The key remains visible in your settings list but cannot be re-activated. Create a new key to restore access.
</Accordion>

<Accordion title="Why can't I create API keys with my guest account?">
  Guest accounts are temporary and are automatically cleaned up after 30 days. A key tied to a deleted account would be a credential pointing at nothing, so Invoice AI restricts key creation to verified accounts only.
</Accordion>

<Accordion title="Can an API key create or revoke other API keys?">
  No. There is no `keys:manage` scope and no API endpoint for key management. Creating and revoking keys is only possible through the web UI. This means a compromised key cannot mint additional credentials, widen its own scopes, or revoke the audit trail of its own activity.
</Accordion>
