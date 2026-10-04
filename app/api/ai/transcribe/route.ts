import { NextResponse, type NextRequest } from 'next/server'
import { experimental_transcribe as transcribe } from 'ai'
import { openai } from '@ai-sdk/openai'

import { checkRateLimit } from '@/lib/api/rate-limit'
import { requireUser } from '@/lib/queries'

export const runtime = 'nodejs'
export const maxDuration = 30

/**
 * Every call is an OpenAI bill, and signing up is free — so a single account
 * scripting this route is a cost attack. Per user, per instance (see
 * lib/api/rate-limit.ts); generous for a person, useless for a loop.
 */
const RATE_LIMIT = { limit: 30, windowSeconds: 3600 }

/** A minute of Opus is well under this; the cap is to stop someone posting a film. */
const MAX_AUDIO_BYTES = 10 * 1024 * 1024

/**
 * Speech to text for the invoice prompt.
 *
 * Whisper rather than the browser's speech API because the words that matter
 * here are Indian business names and rupee amounts, which is exactly where
 * on-device recognition falls down — and a misheard amount is the one error
 * nobody catches by reading a form.
 */
export async function POST(request: NextRequest) {
  const user = await requireUser()

  const limit = await checkRateLimit(user.id, 'ai-transcribe', RATE_LIMIT)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'You’ve hit the hourly limit for AI requests. Try again later.' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfter) } },
    )
  }

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: 'Voice input is not configured yet. Add OPENAI_API_KEY.' },
      { status: 503 },
    )
  }

  const form = await request.formData().catch(() => null)
  const file = form?.get('audio')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No audio received.' }, { status: 400 })
  }

  if (file.size === 0) {
    return NextResponse.json({ error: "We didn't catch that — try again." }, { status: 400 })
  }

  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording is too long.' }, { status: 413 })
  }

  try {
    const { text } = await transcribe({
      model: openai.transcription('whisper-1'),
      audio: new Uint8Array(await file.arrayBuffer()),
      providerOptions: {
        openai: {
          // Indian English, and a nudge toward the vocabulary this app hears.
          language: 'en',
          prompt: 'An instruction to create an invoice, with amounts and client names.',
        },
      },
    })

    return NextResponse.json({ text: text.trim() })
  } catch (cause) {
    console.error('transcribe failed', cause)
    return NextResponse.json({ error: "Couldn't transcribe that. Try typing instead." }, { status: 502 })
  }
}
