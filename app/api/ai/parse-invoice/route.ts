import { NextResponse, type NextRequest } from 'next/server'
import { Output, generateText } from 'ai'
import { openai } from '@ai-sdk/openai'

import { checkRateLimit } from '@/lib/api/rate-limit'
import { requireUser } from '@/lib/queries'
import { AI_INVOICE_SYSTEM_PROMPT, aiInvoiceSchema } from '@/lib/ai/invoice-schema'
import { normaliseDraft } from '@/lib/ai/normalise'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Every call is an OpenAI bill, and signing up is free — so a single account
 * scripting this route is a cost attack. Per user, per instance (see
 * lib/api/rate-limit.ts); generous for a person, useless for a loop.
 */
const RATE_LIMIT = { limit: 60, windowSeconds: 3600 }

/**
 * Parse a natural-language instruction into invoice fields.
 *
 * Returns fields only — nothing is written to the database. The user reviews the
 * populated form and the builder's normal autosave takes over from there, so a
 * misheard amount can never commit itself.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()

  const limit = await checkRateLimit(user.id, 'ai-parse', RATE_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'You’ve hit the hourly limit for AI requests. Try again later.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'AI invoicing is not configured yet. Add OPENAI_API_KEY.' },
      { status: 503 },
    )
  }

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const instruction = typeof body?.text === 'string' ? body.text.trim() : ''

  if (!instruction) {
    return NextResponse.json({ error: 'Say or type what you want to bill for.' }, { status: 400 })
  }

  if (instruction.length > 2000) {
    return NextResponse.json({ error: 'That instruction is too long.' }, { status: 400 })
  }

  try {
    const { output } = await generateText({
      model: openai('gpt-5.6-sol'),
      system: AI_INVOICE_SYSTEM_PROMPT,
      prompt: instruction,
      output: Output.object({ schema: aiInvoiceSchema }),
      // Extraction, not creative writing: the same sentence should produce the
      // same invoice every time.
      temperature: 0,
    })

    return NextResponse.json({ draft: normaliseDraft(output) })
  } catch (cause) {
    console.error('parse-invoice failed', cause)
    return NextResponse.json(
      { error: 'Could not turn that into an invoice. Try rephrasing it.' },
      { status: 502 },
    )
  }
}
