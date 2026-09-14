import { NextResponse, type NextRequest } from 'next/server'
import { experimental_transcribe as transcribe } from 'ai'
import { openai } from '@ai-sdk/openai'

import { requireUser } from '@/lib/queries'

export const runtime = 'nodejs'
export const maxDuration = 30

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
  await requireUser()

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
          prompt: 'An instruction to create a GST invoice, with rupee amounts and Indian names.',
        },
      },
    })

    return NextResponse.json({ text: text.trim() })
  } catch (cause) {
    console.error('transcribe failed', cause)
    return NextResponse.json({ error: "Couldn't transcribe that. Try typing instead." }, { status: 502 })
  }
}
