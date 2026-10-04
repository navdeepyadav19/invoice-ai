# How AI invoice creation works

## Where the system prompt lives

`lib/ai/invoice-schema.ts` — `AI_INVOICE_SYSTEM_PROMPT`, right next to the Zod
schema (`aiInvoiceSchema`) the model must fill in. Every field is
`.nullable()`, never `.optional()` — OpenAI's structured-output mode requires
every property present in the response, so `.optional()` breaks generation
entirely.

## The actual prompt

```
You turn a short spoken or typed instruction into the fields of an invoice.

Rules:
- Amounts are in the user's currency. Strip "$", "€", "₹", "Rs", currency codes and thousands separators. Return plain numbers.
- Understand scale words: "10k" = 10000, "2M" = 2000000.
- "rate" is the price PER UNIT. If the user gives a total for several units, divide.
- Set amount_is_tax_inclusive true ONLY if they explicitly say the figure includes tax.
- Set tax_rate only if the user names a rate; else null.
- Default quantity to 1 and unit to "NOS" when unstated.
- NEVER invent a client name or an amount. If the user didn't say it, return null.
- If the user describes several things, return several items.
- Keep the description close to the user's own wording; do not embellish it.
```

**Show the students:** the model never touches the database. `/api/ai/parse-invoice`
(the call site) returns fields to the browser; nothing saves until the user
reads a computed summary and clicks "Fill this in."

## Where it's called from

- `app/api/ai/parse-invoice/route.ts` — text → `generateText()` with the schema above
- `app/api/ai/transcribe/route.ts` — voice → Whisper → the same text path

## Model, and how to change it

**`gpt-5.6-sol`**, set in one place: `model: openai('gpt-5.6-sol')` in
`parse-invoice/route.ts`. Swap the string, redeploy — the schema and prompt
don't change. Voice transcription uses **`whisper-1`**, in `transcribe/route.ts`.

## Cost

Verified against OpenAI's live pricing page, not a guess:

| | Input | Output |
|---|---|---|
| `gpt-5.6-sol` | $4.00 / 1M tokens | $20.00 / 1M tokens |
| Whisper transcription | $0.006 / minute | — |

One invoice parse is a few hundred tokens each way — a fraction of a cent.

## Where to look in the OpenAI dashboard

Open [platform.openai.com](https://platform.openai.com):

- **Logs** — every request: the exact prompt sent, the JSON returned, latency
- **Usage** — input/output token counts, per model, per day
- **Costs** — the token counts above converted to actual dollars spent
- Click into any one log entry to show students the full round trip: our
  system prompt, their typed sentence, the structured JSON that came back

## What we deliberately don't trust the model with

In `lib/ai/normalise.ts`, unit tested: converting a tax-inclusive amount back
to a pre-tax rate. That is arithmetic, so the code does it, not the model. When
the user names no tax rate, the line gets 0%, not a guessed rate; they set it
in the form.

Before the worldwide release (Sep 2026) the prompt was India-specific (rupees,
lakh/crore, a default 18% GST) and `normalise.ts` also mapped a spoken state
name to a GST state code, because a wrong code silently flipped CGST/SGST to
IGST. Both went with the GST engine.
