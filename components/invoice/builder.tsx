'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, Loader2, PenLine } from 'lucide-react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { AiPanel } from '@/components/invoice/ai-panel'
import { InvoiceDocument } from '@/components/invoice/invoice-document'
import { LineItems } from '@/components/invoice/line-items'
import { SendControls } from '@/components/invoice/send-controls'
import { Field } from '@/components/onboarding/field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { saveInvoiceDraft } from '@/lib/actions/invoice'
import { computeInvoice } from '@/lib/gst'
import { GST_STATES, stateName } from '@/lib/india'
import {
  defaultInvoiceValues,
  toGstInput,
  toSavePayload,
  type InvoiceFormValues,
} from '@/lib/invoice-form'
import { snapshotBusiness, type InvoiceView } from '@/lib/invoice-view'
import type { NormalisedInvoiceDraft } from '@/lib/ai/normalise'
import { cn } from '@/lib/utils'
import type { BusinessRow, InvoiceStatus } from '@/lib/database.types'

const AUTOSAVE_DELAY_MS = 1500

export function InvoiceBuilder({
  business,
  invoiceId: initialInvoiceId,
  initialValues,
  invoiceNumber = null,
  status = 'draft',
  aiEnabled = false,
}: {
  business: BusinessRow
  invoiceId?: string
  initialValues?: InvoiceFormValues
  invoiceNumber?: string | null
  status?: InvoiceStatus
  /** False when OPENAI_API_KEY is unset, so the prompt box is hidden entirely. */
  aiEnabled?: boolean
}) {
  const router = useRouter()
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')

  const form = useForm<InvoiceFormValues>({
    defaultValues: initialValues ?? defaultInvoiceValues(business),
  })

  const values = useWatch({ control: form.control }) as InvoiceFormValues

  // The same engine the server runs, so what the user sees while typing is what
  // gets persisted — no second implementation to drift.
  const computed = useMemo(
    () => computeInvoice(toGstInput(values, business), values.currency || 'INR'),
    [values, business],
  )

  const view: InvoiceView = useMemo(
    () => ({
      business: snapshotBusiness(business),
      client: {
        name: values.client?.name ?? '',
        gstin: values.client?.gstin || null,
        address_line1: values.client?.address_line1 || null,
        address_line2: values.client?.address_line2 || null,
        city: values.client?.city || null,
        state_code: values.client?.state_code || null,
        pincode: values.client?.pincode || null,
        country: values.client?.country || null,
        email: values.client?.email || null,
        phone: values.client?.phone || null,
      },
      number: invoiceNumber,
      status,
      issueDate: values.issue_date,
      dueDate: values.due_date || null,
      currency: values.currency || 'INR',
      placeOfSupplyStateCode: values.place_of_supply_state_code,
      notes: values.notes || null,
      terms: values.terms || null,
      computed,
    }),
    [business, values, computed, invoiceNumber, status],
  )

  const save = useCallback(
    (silent: boolean) => {
      startSaving(async () => {
        const result = await saveInvoiceDraft({ ...toSavePayload(form.getValues()), id: invoiceId })

        if (result.error) {
          // Autosave failures are announced too. Silently dropping them is how
          // someone loses twenty minutes of typing and only finds out later.
          toast.error(result.error)
          return
        }

        if (result.invoiceId && result.invoiceId !== invoiceId) {
          setInvoiceId(result.invoiceId)
          // Replace rather than push so Back doesn't return to a blank /new that
          // would start a second draft.
          router.replace(`/invoices/${result.invoiceId}/edit`)
        }

        setSavedAt(result.savedAt ?? new Date().toISOString())
        if (!silent) toast.success('Draft saved')
      })
    },
    [form, invoiceId, router],
  )

  // Once issued, an invoice is a document rather than a draft: the number is
  // allocated, the client may already have the PDF, and the server refuses
  // writes. Locking the form here means the user is never invited to make an
  // edit that cannot land.
  const isIssued = status !== 'draft'

  const isDirty = form.formState.isDirty
  const hasClient = Boolean(values.client?.name?.trim())
  const hasLine = computed.lines.some((line) => line.description.trim() && line.taxablePaise > 0)
  const canSave = hasClient && hasLine && !isIssued

  // Debounced autosave. Only runs once the invoice is worth saving — otherwise
  // opening the page would immediately create an empty draft.
  useEffect(() => {
    if (!isDirty || !canSave) return

    const timer = setTimeout(() => save(true), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [values, isDirty, canSave, save])

  const showTax = business.is_gst_registered && !values.is_export

  /**
   * Apply an AI-parsed draft to the form.
   *
   * Only fields the model actually returned are written — a null means "the user
   * didn't say", not "clear it". That's what lets someone dictate an amount,
   * then dictate a client name, without the second instruction wiping the first.
   *
   * `shouldDirty` is essential: autosave watches dirty state, so without it a
   * fully AI-filled invoice would sit there unsaved.
   */
  function applyDraft(draft: NormalisedInvoiceDraft) {
    const dirty = { shouldDirty: true } as const

    if (draft.client_name) form.setValue('client.name', draft.client_name, dirty)
    if (draft.client_gstin) form.setValue('client.gstin', draft.client_gstin, dirty)
    if (draft.client_city) form.setValue('client.city', draft.client_city, dirty)
    if (draft.client_email) form.setValue('client.email', draft.client_email, dirty)

    if (draft.place_of_supply_state_code) {
      form.setValue('place_of_supply_state_code', draft.place_of_supply_state_code, dirty)
    }

    if (draft.notes) form.setValue('notes', draft.notes, dirty)

    if (draft.due_in_days !== null) {
      const issued = new Date(form.getValues('issue_date') || new Date().toISOString().slice(0, 10))
      issued.setDate(issued.getDate() + draft.due_in_days)
      form.setValue('due_date', issued.toISOString().slice(0, 10), dirty)
    }

    if (draft.items.length > 0) {
      form.setValue(
        'items',
        draft.items.map((item) => ({
          description: item.description,
          hsn_sac: item.hsn_sac,
          quantity: String(item.quantity),
          unit: item.unit,
          rate: String(item.rate),
          discount_percent: '0',
          gst_rate: String(item.gst_rate),
          cess_rate: '0',
        })),
        dirty,
      )
    }
  }

  return (
    <FormProvider {...form}>
      <div className="border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-3 px-6 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-medium">
              {invoiceNumber ?? 'New invoice'}
            </h1>
            <SaveIndicator saving={isSaving} savedAt={savedAt} />
          </div>

          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5 lg:hidden">
              <TabButton
                active={mobileTab === 'edit'}
                onClick={() => setMobileTab('edit')}
                icon={<PenLine className="size-3.5" />}
              >
                Edit
              </TabButton>
              <TabButton
                active={mobileTab === 'preview'}
                onClick={() => setMobileTab('preview')}
                icon={<Eye className="size-3.5" />}
              >
                Preview
              </TabButton>
            </div>

            {!isIssued && (
              <Button
                variant={invoiceId ? 'outline' : 'default'}
                size="sm"
                onClick={() => save(false)}
                disabled={!canSave || isSaving}
              >
                {isSaving && <Loader2 className="size-4 animate-spin" />}
                Save draft
              </Button>
            )}

            <SendControls
              invoiceId={invoiceId}
              status={status}
              clientEmail={values.client?.email ?? ''}
              // An issued invoice fails `canSave` by design, but re-fetching its
              // share link is exactly what someone comes back here to do.
              disabled={isSaving || (!isIssued && !canSave)}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto grid w-full max-w-7xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <form
          className={cn('space-y-8', mobileTab === 'preview' && 'hidden lg:block')}
          onSubmit={(event) => {
            event.preventDefault()
            save(false)
          }}
        >
          {isIssued && (
            <p className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">
                This invoice has been issued as {invoiceNumber}.
              </span>{' '}
              It can no longer be edited — your client may already have the PDF. Raise a new invoice
              or a credit note instead.
            </p>
          )}

          <fieldset disabled={isIssued} className="space-y-8 disabled:opacity-70">
          {aiEnabled && !isIssued && (
            <AiPanel
              onDraft={applyDraft}
              business={business}
              currency={values.currency || 'INR'}
              disabled={isSaving}
            />
          )}

          <Section title="Bill to" description="Who is this invoice for?">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client name" htmlFor="client.name" required className="sm:col-span-2">
                <Input
                  id="client.name"
                  placeholder="Kadam Retail Pvt Ltd"
                  {...form.register('client.name')}
                />
              </Field>

              <Field label="Client GSTIN" htmlFor="client.gstin" hint="Leave blank for B2C.">
                <Input
                  id="client.gstin"
                  placeholder="27AAPFU0939F1ZV"
                  maxLength={15}
                  className="font-mono uppercase"
                  {...form.register('client.gstin')}
                />
              </Field>

              <Field label="Client email" htmlFor="client.email" hint="Used when you email the invoice.">
                <Input id="client.email" type="email" {...form.register('client.email')} />
              </Field>

              <Field label="Address" htmlFor="client.address_line1" className="sm:col-span-2">
                <Input id="client.address_line1" {...form.register('client.address_line1')} />
              </Field>

              <Field label="City" htmlFor="client.city">
                <Input id="client.city" {...form.register('client.city')} />
              </Field>

              <Field label="PIN code" htmlFor="client.pincode">
                <Input id="client.pincode" maxLength={6} inputMode="numeric" {...form.register('client.pincode')} />
              </Field>
            </div>
          </Section>

          <Section
            title="Invoice details"
            description="The place of supply decides how GST is split."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issue date" htmlFor="issue_date" required>
                <Input id="issue_date" type="date" {...form.register('issue_date')} />
              </Field>

              <Field label="Due date" htmlFor="due_date">
                <Input id="due_date" type="date" {...form.register('due_date')} />
              </Field>

              <Field
                label="Place of supply"
                htmlFor="place_of_supply_state_code"
                required
                hint={
                  business.state_code === values.place_of_supply_state_code
                    ? 'Same state as you — CGST + SGST'
                    : 'Different state — IGST'
                }
                className="sm:col-span-2"
              >
                <Select
                  value={values.place_of_supply_state_code}
                  onValueChange={(value) =>
                    form.setValue('place_of_supply_state_code', value ?? '', { shouldDirty: true })
                  }
                >
                  <SelectTrigger id="place_of_supply_state_code" className="w-full">
                    {/* Base UI renders the raw value, which would show a bare
                        "29" where the user needs to read "Karnataka". */}
                    <SelectValue placeholder="Select a state">
                      {(value) =>
                        value ? `${value} — ${stateName(String(value))}` : 'Select a state'
                      }
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

            {business.is_gst_registered && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Export under LUT"
                  description="Zero-rated, no tax charged."
                  checked={values.is_export}
                  onChange={(checked) => form.setValue('is_export', checked, { shouldDirty: true })}
                />
                <Toggle
                  label="Reverse charge"
                  description="Recipient pays the tax directly."
                  checked={values.reverse_charge}
                  onChange={(checked) =>
                    form.setValue('reverse_charge', checked, { shouldDirty: true })
                  }
                />
              </div>
            )}
          </Section>

          <Section title="Line items" description="What are you billing for?">
            <LineItems showTax={showTax} />
          </Section>

          <Section title="Notes and terms" description="Printed at the foot of the invoice.">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Notes" htmlFor="notes">
                <Textarea id="notes" rows={3} {...form.register('notes')} />
              </Field>
              <Field label="Terms" htmlFor="terms">
                <Textarea id="terms" rows={3} {...form.register('terms')} />
              </Field>
            </div>
          </Section>
          </fieldset>
        </form>

        <div className={cn('lg:sticky lg:top-24 lg:self-start', mobileTab === 'edit' && 'hidden lg:block')}>
          <InvoiceDocument view={view} className="origin-top lg:scale-[0.94]" />
        </div>
      </div>
    </FormProvider>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-medium tracking-tight">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  )
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-3 rounded-lg border border-border bg-card p-3">
      <span className="space-y-0.5">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors',
        active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground',
      )}
    >
      {icon}
      {children}
    </button>
  )
}

function SaveIndicator({ saving, savedAt }: { saving: boolean; savedAt: string | null }) {
  if (saving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    )
  }

  if (!savedAt) return null

  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="size-3 text-success" />
      Saved{' '}
      {new Date(savedAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}
