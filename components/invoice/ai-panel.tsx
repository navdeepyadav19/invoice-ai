'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle,
  Check,
  CornerDownLeft,
  Loader2,
  Mic,
  Send,
  Sparkles,
  Square,
  X,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { summariseDraft, type DraftSummary } from '@/components/invoice/ai-summary'
import { cn } from '@/lib/utils'
import type { NormalisedInvoiceDraft } from '@/lib/ai/normalise'

const EXAMPLES = [
  'Invoice Sharma Traders ₹45,000 for brand design',
  '3 days consulting at 12000 a day for Kadam Retail, net 30',
  'Bill Acme 2 lakh for the website, inclusive of GST',
]

type Phase = 'idle' | 'recording' | 'transcribing' | 'parsing'

interface Turn {
  role: 'you' | 'ai'
  text: string
  summary?: DraftSummary
  draft?: NormalisedInvoiceDraft
}

/**
 * The "Use AI" affordance.
 *
 * Closed by default — the builder is a form first, and an always-open prompt box
 * pushes the actual fields down the page for everyone who wasn't going to use it.
 *
 * The important part is the confirmation step: parsing produces a summary, and
 * nothing touches the form until the user accepts it. A misheard "two lakh" is
 * caught while it's still a sentence on screen rather than after it's become
 * line items someone has to unpick.
 */
export function AiPanel({
  onDraft,
  business,
  currency = 'INR',
  disabled,
}: {
  onDraft: (draft: NormalisedInvoiceDraft) => void
  business: { state_code: string; is_gst_registered: boolean }
  currency?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [phase, setPhase] = useState<Phase>('idle')
  const [turns, setTurns] = useState<Turn[]>([])

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const inputRef = useRef<HTMLInputElement | null>(null)
  const feedRef = useRef<HTMLDivElement | null>(null)

  const canRecord = useSyncExternalStore(
    () => () => {},
    () => typeof window.MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
    () => false,
  )

  useEffect(() => {
    return () => {
      recorderRef.current?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [turns, phase])

  function openPanel() {
    setOpen(true)
    // Focus after paint so the input exists.
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function closePanel() {
    recorderRef.current?.stop()
    recorderRef.current = null
    setOpen(false)
    setPhase('idle')
  }

  async function parse(instruction: string) {
    setTurns((prev) => [...prev, { role: 'you', text: instruction }])
    setText('')
    setPhase('parsing')

    try {
      const response = await fetch('/api/ai/parse-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: instruction }),
      })

      const payload = (await response.json()) as {
        draft?: NormalisedInvoiceDraft
        error?: string
      }

      if (!response.ok || !payload.draft) {
        setTurns((prev) => [
          ...prev,
          { role: 'ai', text: payload.error ?? 'I couldn’t read that. Try rephrasing it.' },
        ])
        return
      }

      const summary = summariseDraft(payload.draft, business, currency)

      setTurns((prev) => [
        ...prev,
        {
          role: 'ai',
          text: summary.missing.length
            ? `Here's what I got — I still need ${summary.missing.join(' and ')}.`
            : "Here's what I understood. Shall I fill this in?",
          summary,
          draft: payload.draft,
        },
      ])
    } catch {
      setTurns((prev) => [...prev, { role: 'ai', text: 'I couldn’t reach the AI service.' }])
    } finally {
      setPhase('idle')
    }
  }

  function accept(turn: Turn) {
    if (!turn.draft) return
    onDraft(turn.draft)
    toast.success('Filled in — check it before saving')
    closePanel()
    setTurns([])
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      chunksRef.current = []

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data)
      }

      recorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop())

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) {
          setPhase('idle')
          return
        }

        setPhase('transcribing')

        const body = new FormData()
        // Whisper picks its decoder from the extension, so the filename matters.
        body.append('audio', blob, `speech.${extensionFor(recorder.mimeType)}`)

        try {
          const response = await fetch('/api/ai/transcribe', { method: 'POST', body })
          const payload = (await response.json()) as { text?: string; error?: string }

          if (!response.ok || !payload.text) {
            toast.error(payload.error ?? 'We didn’t catch that.')
            setPhase('idle')
            return
          }

          await parse(payload.text)
        } catch {
          toast.error('Could not reach the transcription service.')
          setPhase('idle')
        }
      }

      recorder.start()
      recorderRef.current = recorder
      setPhase('recording')
    } catch {
      toast.error('Microphone permission was denied.')
      setPhase('idle')
    }
  }

  function stopRecording() {
    recorderRef.current?.stop()
    recorderRef.current = null
  }

  const busy = phase === 'transcribing' || phase === 'parsing'
  const recording = phase === 'recording'

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={openPanel}
        className="w-full justify-start border-dashed text-muted-foreground hover:border-primary/40 hover:text-foreground"
      >
        <Sparkles className="size-4 text-primary" />
        Use AI — describe the invoice instead of filling the form
      </Button>
    )
  }

  return (
    <section
      aria-label="Describe the invoice with AI"
      className="overflow-hidden rounded-xl border border-primary/25 bg-primary/[0.04]"
    >
      <header className="flex items-center justify-between border-b border-primary/15 px-4 py-2.5">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Describe the invoice
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={closePanel}
          aria-label="Close AI panel"
        >
          <X className="size-4" />
        </Button>
      </header>

      <div ref={feedRef} className="max-h-[22rem] space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tell me what you&rsquo;re billing for. I&rsquo;ll show you what I understood before
              anything goes into the form.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {EXAMPLES.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => setText(example)}
                  className="rounded-full border border-border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                >
                  {example}
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div
            key={index}
            className={cn('flex', turn.role === 'you' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[92%] rounded-lg px-3 py-2 text-sm',
                turn.role === 'you'
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card',
              )}
            >
              <p className={cn(turn.role === 'ai' && 'text-foreground')}>{turn.text}</p>

              {turn.summary && (
                <SummaryCard
                  summary={turn.summary}
                  // Only the newest proposal is actionable: accepting an older one
                  // would apply a draft the user has already moved on from.
                  actionable={index === turns.length - 1}
                  onAccept={() => accept(turn)}
                  onRefine={() => inputRef.current?.focus()}
                />
              )}
            </div>
          </div>
        ))}

        {busy && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            {phase === 'transcribing' ? 'Transcribing…' : 'Reading that…'}
          </p>
        )}
      </div>

      <div className="flex gap-2 border-t border-primary/15 px-4 py-3">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim() && !busy) {
              e.preventDefault()
              void parse(text.trim())
            }
            if (e.key === 'Escape') closePanel()
          }}
          placeholder={recording ? 'Listening…' : 'Invoice Sharma Traders ₹45,000 for design work'}
          disabled={busy || recording}
          className="bg-background"
        />

        {canRecord && (
          <Button
            type="button"
            variant={recording ? 'destructive' : 'outline'}
            size="icon"
            disabled={busy}
            onClick={recording ? stopRecording : startRecording}
            aria-label={recording ? 'Stop recording' : 'Dictate the invoice'}
            className={cn(recording && 'animate-pulse')}
          >
            {recording ? <Square className="size-4" /> : <Mic className="size-4" />}
          </Button>
        )}

        <Button
          type="button"
          size="icon"
          disabled={busy || recording || !text.trim()}
          onClick={() => void parse(text.trim())}
          aria-label="Send"
        >
          <Send className="size-4" />
        </Button>
      </div>
    </section>
  )
}

function SummaryCard({
  summary,
  actionable,
  onAccept,
  onRefine,
}: {
  summary: DraftSummary
  actionable: boolean
  onAccept: () => void
  onRefine: () => void
}) {
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-background p-3">
      {summary.meta.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {summary.meta.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}

      <ul className="space-y-1.5">
        {summary.lines.map((line, i) => (
          <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
            <span className="min-w-0">
              <span className="block truncate font-medium text-foreground">{line.label}</span>
              <span className="text-muted-foreground">{line.detail}</span>
            </span>
            <span className="shrink-0 font-mono tabular-nums">{line.amount}</span>
          </li>
        ))}
      </ul>

      <div className="flex items-baseline justify-between border-t border-border pt-2">
        <span className="text-xs text-muted-foreground">{summary.totalLabel}</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{summary.total}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{summary.taxNote}</p>

      {summary.missing.length > 0 && (
        <p className="flex items-start gap-1.5 rounded border border-warning/30 bg-warning/5 px-2 py-1.5 text-[11px] text-warning">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          You&rsquo;ll need to add {summary.missing.join(' and ')} yourself.
        </p>
      )}

      {actionable && (
        <div className="flex flex-wrap gap-2 pt-0.5">
          <Button type="button" size="sm" onClick={onAccept}>
            <Check className="size-3.5" />
            Fill this in
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onRefine}>
            <CornerDownLeft className="size-3.5" />
            Change something
          </Button>
        </div>
      )}
    </div>
  )
}

/** Whisper infers the codec from the filename extension. */
function extensionFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}
