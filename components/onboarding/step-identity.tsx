'use client'

import { useActionState, useState, useTransition } from 'react'
import { ArrowLeft, Building2, CheckCircle2, Loader2, Search, Store } from 'lucide-react'

import { lookupGstinAction, lookupPanAction } from '@/lib/actions/gst-lookup'
import { saveBusinessStep } from '@/lib/actions/onboarding'
import type { LookupOutcome } from '@/lib/gst-lookup-state'
import type { StepState } from '@/lib/form-state'
import { BUSINESS_TYPE_LABELS, type PrefilledBusiness } from '@/lib/sandbox/map'
import { FormError } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GST_STATES, stateName } from '@/lib/india'
import { GSTIN_REGEX, stateCodeFromGstin } from '@/lib/validators'
import { cn } from '@/lib/utils'
import type { BusinessRow } from '@/lib/database.types'

type Mode = 'ask' | 'gstin' | 'pan' | 'confirm' | 'choose' | 'manual'

export function StepIdentity({
  business,
  lookupAvailable,
}: {
  business: BusinessRow | null
  lookupAvailable: boolean
}) {
  const [saveState, formAction] = useActionState<StepState, FormData>(saveBusinessStep, {})
  const [pending, startLookup] = useTransition()

  // Returning to a half-finished setup should not start from the question again.
  const [mode, setMode] = useState<Mode>(business ? 'manual' : 'ask')
  const [prefill, setPrefill] = useState<PrefilledBusiness | null>(null)
  const [candidates, setCandidates] = useState<PrefilledBusiness[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [lookupError, setLookupError] = useState<string | null>(null)

  const [gstin, setGstin] = useState(business?.gstin ?? '')
  const [pan, setPan] = useState(business?.pan ?? '')
  const [panState, setPanState] = useState(business?.state_code ?? '')

  function apply(outcome: LookupOutcome, fallbackMode: Mode) {
    setLookupError(null)

    if (outcome.status === 'error') {
      setLookupError(outcome.message)
      return
    }

    if (outcome.status === 'manual') {
      setNotice(outcome.message)
      setMode('manual')
      return
    }

    if (outcome.status === 'choose') {
      setCandidates(outcome.candidates)
      setMode('choose')
      return
    }

    setPrefill(outcome.business)
    setNotice(outcome.warning ?? null)
    setMode('confirm')
    void fallbackMode
  }

  const runGstinLookup = () =>
    startLookup(async () => apply(await lookupGstinAction(gstin), 'gstin'))

  const runPanLookup = () =>
    startLookup(async () => apply(await lookupPanAction(pan, panState), 'pan'))

  const pick = (candidate: PrefilledBusiness) =>
    startLookup(async () => apply(await lookupGstinAction(candidate.gstin), 'choose'))

  // ---------------------------------------------------------------- ask
  if (mode === 'ask') {
    return (
      <div className="space-y-4">
        <ChoiceCard
          icon={<Building2 className="size-5" />}
          title="Yes, I have a GSTIN"
          description="We'll pull your registered name, address and business type straight from the GST portal. Nothing to type."
          onClick={() => setMode('gstin')}
        />
        <ChoiceCard
          icon={<Store className="size-5" />}
          title="No, I'm not GST registered"
          description="Your invoices will be issued as a Bill of Supply with no tax columns. We'll ask for a few details instead."
          onClick={() => setMode('pan')}
        />
      </div>
    )
  }

  // -------------------------------------------------------------- gstin
  if (mode === 'gstin') {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => setMode('ask')} />

        <Field
          label="Your GSTIN"
          htmlFor="gstin-lookup"
          required
          error={lookupError ?? undefined}
          hint={
            lookupAvailable
              ? 'We check the checksum before looking it up, so a typo never costs you a wait.'
              : 'GST lookup is not switched on yet — enter it and we’ll take the details manually.'
          }
        >
          <div className="flex gap-2">
            <Input
              id="gstin-lookup"
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runGstinLookup()
                }
              }}
              placeholder="27AAPFU0939F1ZV"
              maxLength={15}
              className="font-mono uppercase"
              autoFocus
              spellCheck={false}
            />
            <Button onClick={runGstinLookup} disabled={pending || !GSTIN_REGEX.test(gstin)}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
              Look up
            </Button>
          </div>
        </Field>

        <button
          type="button"
          onClick={() => setMode('manual')}
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Enter my details manually instead
        </button>
      </div>
    )
  }

  // ---------------------------------------------------------------- pan
  if (mode === 'pan') {
    return (
      <div className="space-y-6">
        <BackLink onClick={() => setMode('ask')} />

        <p className="text-sm text-muted-foreground">
          If you registered for GST at some point we can still find you by PAN. Otherwise skip
          straight to entering your details.
        </p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="PAN" htmlFor="pan-lookup" error={lookupError ?? undefined}>
            <Input
              id="pan-lookup"
              value={pan}
              onChange={(e) => setPan(e.target.value.toUpperCase())}
              placeholder="AAPFU0939F"
              maxLength={10}
              className="font-mono uppercase"
              autoFocus
              spellCheck={false}
            />
          </Field>

          <Field
            label="State"
            htmlFor="pan-state"
            hint="GST registration is per state, so the search needs one."
          >
            <Select value={panState} onValueChange={(v) => setPanState(v ?? '')}>
              <SelectTrigger id="pan-state" className="w-full">
                <SelectValue placeholder="Select a state">
                  {(value) => (value ? `${value} — ${stateName(String(value))}` : 'Select a state')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {GST_STATES.map((s) => (
                  <SelectItem key={s.code} value={s.code}>
                    <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={runPanLookup} disabled={pending || pan.length !== 10 || !panState}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
            Try the lookup
          </Button>
          <Button variant="ghost" onClick={() => setMode('manual')}>
            Skip, I&rsquo;ll type my details
          </Button>
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------- choose
  if (mode === 'choose') {
    return (
      <div className="space-y-5">
        <BackLink onClick={() => setMode('pan')} />
        <p className="text-sm text-muted-foreground">
          That PAN has more than one GST registration. Which one are you invoicing from?
        </p>

        <div className="space-y-3">
          {candidates.map((candidate) => (
            <button
              key={candidate.gstin}
              type="button"
              disabled={pending}
              onClick={() => pick(candidate)}
              className="w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent/40 disabled:opacity-60"
            >
              <p className="font-medium">{candidate.trade_name || candidate.legal_name}</p>
              <p className="font-mono text-xs text-muted-foreground">{candidate.gstin}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {[candidate.city, stateName(candidate.state_code)].filter(Boolean).join(', ')}
              </p>
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ------------------------------------------------------------ confirm
  if (mode === 'confirm' && prefill) {
    return (
      <form action={formAction} className="space-y-6">
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <CheckCircle2 className="size-4" />
            Found it on the GST portal
          </p>
        </div>

        {notice && (
          <p className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
            {notice}
          </p>
        )}

        <dl className="divide-y divide-border rounded-lg border border-border bg-card">
          <SummaryRow label="Legal name" value={prefill.legal_name} />
          {prefill.trade_name && <SummaryRow label="Trade name" value={prefill.trade_name} />}
          <SummaryRow label="GSTIN" value={prefill.gstin} mono />
          <SummaryRow
            label="Business type"
            value={prefill.constitution ?? BUSINESS_TYPE_LABELS[prefill.business_type]}
          />
          <SummaryRow
            label="Address"
            value={
              [prefill.address_line1, prefill.address_line2, prefill.city, prefill.pincode]
                .filter(Boolean)
                .join(', ') || '—'
            }
          />
          <SummaryRow
            label="State"
            value={`${prefill.state_code} — ${stateName(prefill.state_code)}`}
          />
        </dl>

        <PrefillFields prefill={prefill} />

        <FormError message={saveState.error} />

        <div className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => setMode('manual')}>
            Something&rsquo;s wrong — let me edit
          </Button>
          <SubmitButton size="lg" pendingLabel="Saving…">
            Looks right, continue
          </SubmitButton>
        </div>
      </form>
    )
  }

  // ------------------------------------------------------------- manual
  return (
    <ManualForm
      business={business}
      prefill={prefill}
      notice={notice}
      formAction={formAction}
      saveState={saveState}
      seedGstin={gstin}
      seedPan={pan}
      seedState={panState}
      onBack={() => setMode('ask')}
    />
  )
}

/**
 * The confirmed registry values, posted as hidden inputs.
 *
 * The visible screen is a read-only summary, but the server action validates the
 * same `businessSchema` regardless of which path produced the data — so the
 * prefilled path and the typed path can never diverge in what they're allowed
 * to save.
 */
function PrefillFields({ prefill }: { prefill: PrefilledBusiness }) {
  return (
    <>
      <input type="hidden" name="legal_name" value={prefill.legal_name} />
      <input type="hidden" name="trade_name" value={prefill.trade_name ?? ''} />
      <input type="hidden" name="is_gst_registered" value="on" />
      <input type="hidden" name="gstin" value={prefill.gstin} />
      <input type="hidden" name="address_line1" value={prefill.address_line1 ?? ''} />
      <input type="hidden" name="address_line2" value={prefill.address_line2 ?? ''} />
      <input type="hidden" name="city" value={prefill.city ?? ''} />
      <input type="hidden" name="state_code" value={prefill.state_code} />
      <input type="hidden" name="pincode" value={prefill.pincode ?? ''} />
      <input type="hidden" name="business_type" value={prefill.business_type} />
      <input type="hidden" name="gst_constitution" value={prefill.constitution ?? ''} />
      <input type="hidden" name="gst_status" value={prefill.gst_status ?? ''} />
      <input type="hidden" name="gst_registered_on" value={prefill.registered_on ?? ''} />
      <input type="hidden" name="gst_data" value={JSON.stringify(prefill)} />
    </>
  )
}

function ManualForm({
  business,
  prefill,
  notice,
  formAction,
  saveState,
  seedGstin,
  seedPan,
  seedState,
  onBack,
}: {
  business: BusinessRow | null
  prefill: PrefilledBusiness | null
  notice: string | null
  formAction: (formData: FormData) => void
  saveState: StepState
  seedGstin: string
  seedPan: string
  seedState: string
  onBack: () => void
}) {
  const initialGstin = prefill?.gstin ?? seedGstin ?? business?.gstin ?? ''

  const [gstin, setGstin] = useState(initialGstin)

  // Derive the state from the GSTIN we arrived with, not just from ones typed
  // here. Someone who entered a GSTIN on the lookup screen and fell through to
  // this form has already told us their state — asking again is the app failing
  // to read its own input.
  const [stateCode, setStateCode] = useState(
    prefill?.state_code ||
      seedState ||
      business?.state_code ||
      (GSTIN_REGEX.test(initialGstin) ? (stateCodeFromGstin(initialGstin) ?? '') : ''),
  )

  /**
   * Controlled, because a failed server validation re-renders this form and
   * React resets it — uncontrolled inputs would silently drop everything the
   * user typed at exactly the moment they're being asked to correct it.
   */
  const [legalName, setLegalName] = useState(prefill?.legal_name ?? business?.legal_name ?? '')
  const [tradeName, setTradeName] = useState(prefill?.trade_name ?? business?.trade_name ?? '')
  const [address, setAddress] = useState(prefill?.address_line1 ?? business?.address_line1 ?? '')
  const [city, setCity] = useState(prefill?.city ?? business?.city ?? '')
  const [pincode, setPincode] = useState(prefill?.pincode ?? business?.pincode ?? '')

  const registered = gstin.trim().length > 0
  const errors = saveState.fieldErrors ?? {}

  function handleGstin(value: string) {
    const next = value.toUpperCase()
    setGstin(next)
    if (GSTIN_REGEX.test(next)) {
      const derived = stateCodeFromGstin(next)
      if (derived) setStateCode(derived)
    }
  }

  return (
    <form action={formAction} className="space-y-6">
      <BackLink onClick={onBack} />

      {notice && (
        <p className="rounded-md border border-border bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          {notice}
        </p>
      )}

      {/* An empty GSTIN is what makes this a Bill of Supply, so the flag is
          derived from the field rather than a separate toggle to keep in sync. */}
      <input type="hidden" name="is_gst_registered" value={registered ? 'on' : ''} />
      <input type="hidden" name="pan" value={seedPan} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Legal name"
          htmlFor="legal_name"
          required
          error={errors.legal_name}
          hint="As it appears on your PAN or GST certificate."
          className="sm:col-span-2"
        >
          <Input
            id="legal_name"
            name="legal_name"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            placeholder="Umbrella Design Studio"
            required
          />
        </Field>

        <Field
          label="Trade name"
          htmlFor="trade_name"
          error={errors.trade_name}
          hint="Optional — what clients know you as."
        >
          <Input
            id="trade_name"
            name="trade_name"
            value={tradeName}
            onChange={(e) => setTradeName(e.target.value)}
          />
        </Field>

        <Field
          label="GSTIN"
          htmlFor="gstin"
          error={errors.gstin}
          hint="Leave blank if you're not registered."
        >
          <Input
            id="gstin"
            name="gstin"
            value={gstin}
            onChange={(e) => handleGstin(e.target.value)}
            placeholder="27AAPFU0939F1ZV"
            maxLength={15}
            className="font-mono uppercase"
            spellCheck={false}
          />
        </Field>

        <Field
          label="Address"
          htmlFor="address_line1"
          required
          error={errors.address_line1}
          className="sm:col-span-2"
        >
          <Input
            id="address_line1"
            name="address_line1"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="4th Floor, Trade Centre"
            required
          />
        </Field>

        <input
          type="hidden"
          name="address_line2"
          value={prefill?.address_line2 ?? business?.address_line2 ?? ''}
        />

        <Field label="City" htmlFor="city" required error={errors.city}>
          <Input
            id="city"
            name="city"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            placeholder="Mumbai"
            required
          />
        </Field>

        <Field
          label="State"
          htmlFor="state_code"
          required
          error={errors.state_code}
          hint="Decides whether you charge CGST+SGST or IGST."
        >
          <Select
            name="state_code"
            value={stateCode}
            onValueChange={(v) => setStateCode(v ?? '')}
            required
          >
            <SelectTrigger id="state_code" className="w-full">
              <SelectValue placeholder="Select your state">
                {(value) => (value ? `${value} — ${stateName(String(value))}` : 'Select your state')}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {GST_STATES.map((s) => (
                <SelectItem key={s.code} value={s.code}>
                  <span className="font-mono text-xs text-muted-foreground">{s.code}</span>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="PIN code" htmlFor="pincode" error={errors.pincode}>
          <Input
            id="pincode"
            name="pincode"
            value={pincode}
            onChange={(e) => setPincode(e.target.value)}
            placeholder="400051"
            maxLength={6}
            inputMode="numeric"
          />
        </Field>
      </div>

      <FormError message={saveState.error} />

      <div className="flex justify-end">
        <SubmitButton size="lg" pendingLabel="Saving…">
          Continue
        </SubmitButton>
      </div>
    </form>
  )
}

function ChoiceCard({
  icon,
  title,
  description,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-4 rounded-xl border border-border bg-card p-5 text-left transition-all',
        'hover:border-primary/40 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40',
      )}
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        {icon}
      </span>
      <span className="space-y-1">
        <span className="block font-medium tracking-tight">{title}</span>
        <span className="block text-sm leading-relaxed text-muted-foreground">{description}</span>
      </span>
    </button>
  )
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
      <dt className="text-xs uppercase tracking-[0.1em] text-muted-foreground">{label}</dt>
      <dd className={cn('text-sm', mono && 'font-mono')}>{value}</dd>
    </div>
  )
}

function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" />
      Back
    </button>
  )
}
