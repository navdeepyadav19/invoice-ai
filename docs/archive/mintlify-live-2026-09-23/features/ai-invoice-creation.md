
# Create Invoices with the AI Assistant

> Use the Invoice AI assistant to generate invoices from plain text or voice — just describe what you're billing for and confirm the result.

The AI assistant lets you skip the form entirely. Describe your invoice in plain English — or speak it aloud — and the AI parses it into structured fields for you to review before anything is filled in.

<Note>
  The AI assistant is an optional feature. If the **Use AI** button isn't visible in the invoice builder, the feature hasn't been enabled for your instance yet — contact your administrator.
</Note>

## Open the AI chat panel

In the invoice builder, click **Use AI** near the top of the form. A chat panel opens above the builder fields — your existing form stays untouched until you explicitly confirm the result.

## Describe your invoice

Type a natural-language description of what you want to bill for. The AI understands amounts, client names, line items, and common billing phrases.

**Examples:**

```text theme={null}
Invoice Acme $45,000 for brand design
```

```text theme={null}
Bill TechCorp 3 days of consulting at $1,200/day, 10% tax
```

```text theme={null}
Invoice Sarah Chen $850 for logo redesign and $200 for brand guidelines
```

Be as specific or brief as you like. You can include the client name, individual line items, amounts, quantities, and a tax rate. The AI extracts everything it can and flags anything it's uncertain about.

## Review the summary

Before any field is touched, the AI shows you a **confirmation summary** — a structured breakdown of what it understood:

* **Client** — the name it matched or inferred
* **Line items** — description, quantity, and unit price for each item
* **Totals** — subtotal, tax, and total
* **Tax note** — any tax rate or exemption it detected

Read through the summary carefully. If anything looks wrong, dismiss it and rephrase your instruction.

<Warning>
  The AI does **not** automatically reverse-calculate a pre-tax amount from a tax-inclusive total. If you say "invoice $1,100 including 10% tax," the AI won't split that into $1,000 + \$100 — enter the pre-tax amount directly to avoid surprises.
</Warning>

## Fill the form

Once you're happy with the summary, click **Fill this in**. The AI populates the invoice builder fields with the parsed values. The builder's normal auto-save takes over from there — nothing is committed until that point.

<Tip>
  After the AI fills the form, you can still edit any field manually before finalizing. Treat the AI output as a fast starting point, not a locked draft.
</Tip>

## Use your voice instead of typing

You can dictate your invoice description instead of typing it:

<Steps>
  <Step title="Click the microphone icon">
    Inside the AI chat panel, click the **microphone** button. Your browser will ask for microphone permission the first time.
  </Step>

  <Step title="Speak your invoice description">
    Describe your invoice out loud — for example, *"Invoice Horizon Labs five thousand dollars for UX audit."* The browser records your audio using the built-in `MediaRecorder` API.
  </Step>

  <Step title="Stop recording">
    Click the microphone button again to stop. The audio is sent for transcription and converted to text using speech recognition.
  </Step>

  <Step title="Confirm the transcription">
    The transcribed text appears in the chat panel. The AI then parses it exactly as it would a typed instruction — you'll see the confirmation summary before anything is filled in.
  </Step>
</Steps>

<Note>
  Voice input depends on your browser's `MediaRecorder` API. Modern versions of Chrome, Firefox, Edge, and Safari all support it. If the microphone button is greyed out, check that your browser has microphone access.
</Note>

## How the AI works

When you submit a text instruction, the AI parses it against a strict structured schema — the same description produces the same invoice every time. The result is validated and normalised before being returned to the form.

**Nothing is written to the database during this process.** The AI returns field values only. The invoice is saved through the builder's standard auto-save flow, which starts only after you click **Fill this in** and the fields are populated.

If the AI cannot parse your instruction, it returns an error message asking you to rephrase. Try breaking a complex description into simpler parts — for example, separate the client name from the line items if the first attempt misreads one of them.
