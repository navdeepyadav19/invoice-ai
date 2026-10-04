# How AI invoice creation works

## Where the system prompt lives

`lib/ai/invoice-schema.ts` — `AI_INVOICE_SYSTEM_PROMPT`, right next to the Zod
schema (`aiInvoiceSchema`) the model must fill in. Every field is
`.nullable()`, never `.optional()` — OpenAI's structured-output mode requires
every property present in the response, so `.optional()` breaks generation
entirely.

## The actual prompt

```
You turn a short spoken or typed instruction into the fields of an Indian GST invoice.

Rules:
- Amounts are in Indian rupees. Strip "₹", "Rs", "INR" and thousands separators.
- Understand Indian numbering: "10k" = 10000, "2 lakh" = 200000, "1.5 crore" = 15000000.
- "rate" is PER UNIT. If given a total for several units, divide.
- Set amount_is_tax_inclusive true ONLY if explicitly stated.
- Default gst_rate to 18, quantity to 1, unit to "NOS" when unstated.
- NEVER invent a client name, amount, or GSTIN — return null instead.
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

Both in `lib/ai/normalise.ts`, both unit tested: converting a tax-inclusive
amount back to a pre-tax rate (arithmetic), and turning a spoken state name
into a GST code (a lookup it would hallucinate — a wrong one silently flips
CGST/SGST to IGST on the invoice).
