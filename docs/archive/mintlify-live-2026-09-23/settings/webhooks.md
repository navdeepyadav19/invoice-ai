
# Webhook Endpoints — Real-Time Invoice Notifications

> Set up HTTPS endpoints to receive real-time invoice events, verify delivery signatures, and automate workflows when invoices are created, paid, or voided.

Webhooks let Invoice AI push event notifications to your server in real time. Instead of polling the API to check whether an invoice has been paid or viewed, you register an HTTPS endpoint and Invoice AI calls it whenever a matching event occurs.

Common use cases include:

* Triggering an accounting entry when an invoice is marked paid.
* Sending a Slack message when an invoice email bounces.
* Updating a CRM when a client views or downloads an invoice.
* Kicking off a fulfillment workflow when a finalized invoice is created.

To manage webhook endpoints, go to **Settings → Webhooks**, or use the API (`POST /api/v1/webhook-endpoints`) with a key that carries the `webhooks:manage` scope.

***

## Creating a webhook endpoint

<Steps>
  <Step title="Open Webhooks settings">
    Go to **Settings → Webhooks** and click **Add endpoint**.
  </Step>

  <Step title="Enter your endpoint URL">
    Enter the full HTTPS URL of your receiver. The URL must use `https://` — plain HTTP is not accepted.
  </Step>

  <Step title="Select events">
    Choose the specific events you want delivered to this endpoint, or select **All events** to receive everything. Subscribing only to the events you need reduces noise and processing load on your server.
  </Step>

  <Step title="Save and copy your signing secret">
    Click **Create**. Invoice AI displays the signing secret (`whsec_…`) **once**. Copy it immediately and store it securely — you will need it to verify incoming webhook signatures. You cannot retrieve it again.
  </Step>
</Steps>

<Warning>
  The signing secret is shown **only at creation time**. If you navigate away without saving it, delete the endpoint and create a new one. Invoice AI cannot re-display a webhook secret.
</Warning>

***

## Available events

Invoice AI fires the following events. Subscribe to individual events or to all of them.

| Event name             | When it fires                                                |
| ---------------------- | ------------------------------------------------------------ |
| `invoice.created`      | A draft invoice was created                                  |
| `invoice.updated`      | A draft invoice was edited                                   |
| `invoice.finalized`    | An invoice was finalized and a permanent number was assigned |
| `invoice.emailed`      | An invoice was successfully emailed to a client              |
| `invoice.email_failed` | An invoice email bounced or failed to deliver                |
| `invoice.viewed`       | A client opened the invoice link                             |
| `invoice.downloaded`   | A client downloaded the invoice PDF                          |
| `invoice.paid`         | An invoice was marked as paid                                |
| `invoice.voided`       | An invoice was voided                                        |

<Tip>
  Subscribe to `invoice.email_failed` so you can proactively follow up with clients when an automated send doesn't reach them — this event is easy to miss without notifications.
</Tip>

***

## Webhook payload structure

Every delivery is an HTTP POST request to your endpoint with a JSON body in this shape:

```json theme={null}
{
  "type": "invoice.paid",
  "data": {
    "object": {
      "id": "inv_01HXYZ...",
      "number": "ACME-1042",
      "status": "paid",
      "currency": "USD",
      "total": 250000,
      "client": {
        "name": "Globex Corporation",
        "email": "accounts@globex.example"
      },
      "paid_at": "2025-06-15T09:42:11Z"
    }
  }
}
```

The `data.object` field contains the full invoice object at the time the event was fired.

### Example: `invoice.paid`

```json theme={null}
{
  "type": "invoice.paid",
  "data": {
    "object": {
      "id": "inv_01HXYZ4KR2VFNQ8TMPBW3JCEG",
      "number": "ACME-1042",
      "status": "paid",
      "currency": "USD",
      "subtotal": 240000,
      "tax": 10000,
      "total": 250000,
      "issue_date": "2025-06-01",
      "due_date": "2025-06-30",
      "paid_at": "2025-06-15T09:42:11Z",
      "client": {
        "name": "Globex Corporation",
        "email": "accounts@globex.example",
        "tax_id": "98-7654321"
      },
      "items": [
        {
          "description": "Consulting — June 2025",
          "quantity": 10,
          "unit": "HRS",
          "rate": 24000,
          "tax_rate": 10,
          "total": 264000
        }
      ]
    }
  }
}
```

***

## Delivery headers

Every webhook delivery includes these HTTP headers:

| Header              | Description                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `webhook-id`        | A unique ID for this delivery attempt (e.g., `msg_2Kf…`). Use this to deduplicate retries. |
| `webhook-timestamp` | Unix timestamp (seconds) of when the delivery was attempted.                               |
| `webhook-signature` | `v1,<base64 HMAC-SHA256>` of the signed string (see below).                                |
| `content-type`      | `application/json; charset=utf-8`                                                          |
| `user-agent`        | `Invoice-AI-Webhooks/1.0`                                                                  |

Invoice AI uses the [Standard Webhooks](https://www.standardwebhooks.com/) signing scheme. The signature covers the delivery ID, timestamp, and body together — binding all three prevents replay attacks.

***

## Verifying signatures

You must verify the `webhook-signature` header on every incoming request before processing it. Skipping this step means your endpoint will process requests from anyone who discovers its URL.

### How signing works

Invoice AI computes the signature over the string `{webhook-id}.{webhook-timestamp}.{raw-body}` using HMAC-SHA256 with your endpoint's signing secret (base64-decoded from the `whsec_` prefix). The result is base64-encoded and prefixed with `v1,`.

**Replay protection:** The timestamp is included in the signed string and Invoice AI rejects any delivery attempt your receiver flags as having a timestamp more than **5 minutes** in the past or future. Always validate the timestamp as part of signature verification.

### Node.js verification example

```javascript theme={null}
const crypto = require('crypto');

/**
 * Verify an incoming Invoice AI webhook delivery.
 *
 * @param {string} rawBody    - The raw (unparsed) request body as a string.
 * @param {object} headers    - The request headers object.
 * @param {string} secret     - Your endpoint's signing secret (whsec_...).
 * @returns {{ ok: boolean, reason?: string }}
 */
function verifyWebhook(rawBody, headers, secret) {
  const msgId        = headers['webhook-id'];
  const msgTimestamp = headers['webhook-timestamp'];
  const msgSignature = headers['webhook-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) {
    return { ok: false, reason: 'missing_headers' };
  }

  // Reject requests outside the 5-minute tolerance window.
  const now = Math.floor(Date.now() / 1000);
  const timestamp = Number(msgTimestamp);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > 300) {
    return { ok: false, reason: 'timestamp_out_of_tolerance' };
  }

  // Decode the whsec_ secret.
  const secretBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice('whsec_'.length), 'base64url')
    : Buffer.from(secret, 'utf8');

  // Compute the expected signature.
  const signedString = `${msgId}.${msgTimestamp}.${rawBody}`;
  const expectedMac  = crypto
    .createHmac('sha256', secretBytes)
    .update(signedString)
    .digest('base64');
  const expected = `v1,${expectedMac}`;

  // The header may carry multiple space-separated signatures during key rotation.
  const presented = msgSignature.split(' ').filter(Boolean);
  const matched = presented.some((candidate) => {
    const a = Buffer.from(candidate, 'utf8');
    const b = Buffer.from(expected,   'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  });

  return matched ? { ok: true } : { ok: false, reason: 'signature_mismatch' };
}
```

<Warning>
  Always use a **constant-time comparison** (`crypto.timingSafeEqual`) when comparing signatures. A plain `===` leaks timing information that could allow an attacker to forge a valid signature character by character.
</Warning>

### Python verification example

```python theme={null}
import hashlib
import hmac
import base64
import time

def verify_webhook(raw_body: str, headers: dict, secret: str) -> dict:
    """
    Verify an incoming Invoice AI webhook delivery.

    raw_body  — the raw (unparsed) request body as a string
    headers   — a dict-like object of request headers (lowercase keys)
    secret    — your endpoint's signing secret (whsec_...)
    """
    msg_id        = headers.get('webhook-id')
    msg_timestamp = headers.get('webhook-timestamp')
    msg_signature = headers.get('webhook-signature')

    if not (msg_id and msg_timestamp and msg_signature):
        return {'ok': False, 'reason': 'missing_headers'}

    # Reject requests outside the 5-minute tolerance window.
    try:
        timestamp = int(msg_timestamp)
    except ValueError:
        return {'ok': False, 'reason': 'bad_timestamp'}

    if abs(int(time.time()) - timestamp) > 300:
        return {'ok': False, 'reason': 'timestamp_out_of_tolerance'}

    # Decode the whsec_ secret (base64url after the prefix).
    if secret.startswith('whsec_'):
        secret_bytes = base64.urlsafe_b64decode(secret[len('whsec_'):] + '==')
    else:
        secret_bytes = secret.encode('utf-8')

    # Build the signed string and compute the expected signature.
    signed_string = f"{msg_id}.{msg_timestamp}.{raw_body}".encode('utf-8')
    mac = hmac.new(secret_bytes, signed_string, hashlib.sha256).digest()
    expected = 'v1,' + base64.b64encode(mac).decode('utf-8')

    # The header may carry multiple space-separated signatures during rotation.
    presented = [s for s in msg_signature.split(' ') if s]
    matched = any(hmac.compare_digest(candidate, expected) for candidate in presented)

    return {'ok': True} if matched else {'ok': False, 'reason': 'signature_mismatch'}
```

### Express.js integration

```javascript theme={null}
const express = require('express');
const crypto  = require('crypto');
const app     = express();

// IMPORTANT: parse the body as raw bytes so the signature check
// runs over the exact bytes Invoice AI signed.
app.post(
  '/webhooks/invoice-ai',
  express.raw({ type: 'application/json' }),
  (req, res) => {
    const result = verifyWebhook(
      req.body.toString('utf8'),
      req.headers,
      process.env.INVOICE_AI_WEBHOOK_SECRET
    );

    if (!result.ok) {
      console.warn('Webhook rejected:', result.reason);
      return res.status(400).json({ error: result.reason });
    }

    const event = JSON.parse(req.body);

    switch (event.type) {
      case 'invoice.paid':
        handleInvoicePaid(event.data.object);
        break;
      case 'invoice.email_failed':
        handleEmailFailed(event.data.object);
        break;
      // ... handle other events
    }

    res.json({ received: true });
  }
);
```

<Note>
  Read the raw request body **before** any JSON-parsing middleware touches it. JSON parsers may reformat the body (different key ordering, whitespace), which changes the byte sequence and breaks the signature check. In Express, use `express.raw({ type: 'application/json' })` on the webhook route instead of `express.json()`.
</Note>

***

## Delivery and retries

Invoice AI delivers each event as a single HTTP POST. Your endpoint must respond with a `2xx` status code within the timeout window to acknowledge successful receipt.

If your endpoint returns a non-2xx status code or times out, Invoice AI retries the delivery with exponential back-off. Each retry carries the same `webhook-id` header — use this to deduplicate events safely in your receiver.

***

## Deleting an endpoint

To stop receiving deliveries, go to **Settings → Webhooks**, find the endpoint in the list, and click **Delete**. Deletion is immediate. Any in-flight deliveries may still arrive for a few seconds after deletion.

***

## Frequently asked questions

<Accordion title="Can I subscribe to all events with a single endpoint?">
  Yes. When creating an endpoint, choose **All events** instead of selecting individual event types. Your endpoint will receive every event Invoice AI fires, now and in the future.
</Accordion>

<Accordion title="What should I do if I lose my signing secret?">
  You cannot retrieve the signing secret after the creation dialog is closed. Delete the endpoint from **Settings → Webhooks** and create a new one. Update the secret in your receiver's environment at the same time.
</Accordion>

<Accordion title="Can I have multiple endpoints subscribed to the same events?">
  Yes. You can create as many endpoints as you need. Each has its own URL, signing secret, and event subscriptions. Invoice AI delivers to all matching endpoints independently.
</Accordion>

<Accordion title="How do I handle duplicate deliveries?">
  Use the `webhook-id` header as an idempotency key. Store processed IDs in your database with a unique constraint, or check before processing. If you see an ID you have already handled, return `200` without re-processing.
</Accordion>

<Accordion title="Can I create webhook endpoints via the API instead of the UI?">
  Yes. Send a `POST` to `/api/v1/webhook-endpoints` with a key that has the `webhooks:manage` scope. The response includes the signing secret — treat it the same way as if you created the endpoint in the UI. It will not be returned again.
</Accordion>

<Accordion title="Why does signature verification fail even though my secret is correct?">
  The most common cause is that a JSON-parsing middleware reformatted the body before your signature check ran. Ensure you compute the signature over the **raw, unmodified request body bytes**. Also confirm you are reading `webhook-id` and `webhook-timestamp` as exact strings — do not cast the timestamp to a number before building the signed string.
</Accordion>
