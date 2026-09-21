'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Eye, Loader2, PenLine, UserRound } from 'lucide-react'
import { FormProvider, useForm, useWatch } from 'react-hook-form'
import { toast } from 'sonner'

import { AiPanel } from '@/components/invoice/ai-panel'
import { InvoiceDocument } from '@/components/invoice/invoice-document'
import { LineItems } from '@/components/invoice/line-items'
import { SearchPicker } from '@/components/invoice/search-picker'
import { SendControls } from '@/components/invoice/send-controls'
import { Field } from '@/components/onboarding/field'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { saveInvoiceDraft } from '@/lib/actions/invoice'
import { searchCustomers } from '@/lib/actions/catalog-search'
import { computeInvoice } from '@/lib/tax'
import { COUNTRIES, CURRENCIES, defaultsForCountry } from '@/lib/locale/countries'
import {
  defaultInvoiceValues,
  toTaxInput,
  toSavePayload,
  type InvoiceFormValues,
} from '@/lib/invoice-form'
import { snapshotBusiness, type InvoiceView } from '@/lib/invoice-view'
import type { NormalisedInvoiceDraft } from '@/lib/ai/normalise'
import {
  clientDiffers,
  customerLinkForSave,
  customerToFormClient,
  isCurrencyMismatch,
  type ClientFormValue,
  type CustomerOption,
} from '@/lib/catalog/picker'
import { cn } from '@/lib/utils'
import type { BusinessRow, InvoiceStatus } from '@/lib/database.types'

const AUTOSAVE_DELAY_MS = 1500

/** The saved customer the Bill-to block is currently linked to. */
export interface LinkedCustomer {
  /** `cus_…` */
  id: string
  /** What the pick wrote into the form; any difference means the user edited. */
  snapshot: ClientFormValue
}

export function InvoiceBuilder({
  business,
  invoiceId: initialInvoiceId,
  initialValues,
  invoiceNumber = null,
  status = 'draft',
  aiEnabled = false,
  pickers = { customers: false, prices: false },
  initialCustomer = null,
}: {
  business: BusinessRow
  invoiceId?: string
  initialValues?: InvoiceFormValues
  invoiceNumber?: string | null
  status?: InvoiceStatus
  /** False when OPENAI_API_KEY is unset, so the prompt box is hidden entirely. */
  aiEnabled?: boolean
  /** Which search pickers to offer. Hidden for guests and when there's nothing saved. */
  pickers?: { customers: boolean; prices: boolean }
  /** Set when a stored draft bills a saved customer (see isSavedCustomerLink). */
  initialCustomer?: LinkedCustomer | null
}) {
  const router = useRouter()
  const [invoiceId, setInvoiceId] = useState(initialInvoiceId)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [isSaving, startSaving] = useTransition()
  const [mobileTab, setMobileTab] = useState<'edit' | 'preview'>('edit')

  // Saved-customer linking. `linked` is what the form shows right now;
  // `persistedCustomer` is what the stored draft points at. Their difference
  // decides the `customer` field of the next save (customerLinkForSave).
  const [linked, setLinked] = useState<LinkedCustomer | null>(initialCustomer)
  const [persistedCustomer, setPersistedCustomer] = useState<string | null>(
    initialCustomer?.id ?? null,
  )
  const customerSearchRef = useRef<HTMLInputElement>(null)

  const form = useForm<InvoiceFormValues>({
    defaultValues: initialValues ?? defaultInvoiceValues(business),
  })

  const values = useWatch({ control: form.control }) as InvoiceFormValues
  const countryDefaults = useMemo(
    () => defaultsForCountry(business.country_code),
    [business.country_code],
  )

  // The same engine the server runs, so what the user sees while typing is what
  // gets persisted — no second implementation to drift.
  const computed = useMemo(
    () => computeInvoice(toTaxInput(values), values.currency || business.currency || 'USD'),
    [values, business.currency],
  )

  const view: InvoiceView = useMemo(
    () => ({
      business: snapshotBusiness(business),
      client: {
        name: values.client?.name ?? '',
        tax_id: values.client?.tax_id || null,
        address_line1: values.client?.address_line1 || null,
        address_line2: values.client?.address_line2 || null,
        city: values.client?.city || null,
        region: values.client?.region || null,
        postal_code: values.client?.postal_code || null,
        country_code: values.client?.country_code || null,
        email: values.client?.email || null,
        phone: values.client?.phone || null,
      },
      number: invoiceNumber,
      status,
      issueDate: values.issue_date,
      dueDate: values.due_date || null,
      currency: values.currency || business.currency || 'USD',
      notes: values.notes || null,
      terms: values.terms || null,
      computed,
    }),
    [business, values, computed, invoiceNumber, status],
  )

  // Editing any Bill-to field after picking a saved customer detaches the
  // invoice from it (sticky — retyping the old value doesn't re-link). The
  // saved customer is never rewritten from here; the next save gives this
  // draft its own row. Adjusting state during render is React's pattern for
  // state derived from other state.
  // getValues, not the watched copy: it is updated synchronously by
  // setValue, so the render right after a pick can't see stale fields and
  // detach immediately.
  if (linked && clientDiffers(form.getValues('client'), linked.snapshot)) {
    setLinked(null)
  }

  const invoiceCurrency = values.currency || business.currency || 'USD'

  const save = useCallback(
    (silent: boolean) => {
      const customer = customerLinkForSave(linked?.id ?? null, persistedCustomer)

      startSaving(async () => {
        const result = await saveInvoiceDraft({
          ...toSavePayload(form.getValues()),
          id: invoiceId,
          ...(customer !== undefined ? { customer } : {}),
        })

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

        // null (detached) means the draft now owns a fresh row, so later
        // saves go back to updating that row in place.
        if (customer !== undefined) setPersistedCustomer(customer)

        setSavedAt(result.savedAt ?? new Date().toISOString())
        if (!silent) toast.success('Draft saved')
      })
    },
    [form, invoiceId, router, linked, persistedCustomer],
  )

  function pickCustomer(customer: CustomerOption) {
    const snapshot = customerToFormClient(customer, business.country_code)
    for (const [key, value] of Object.entries(snapshot) as Array<[keyof ClientFormValue, string]>) {
      form.setValue(`client.${key}`, value, { shouldDirty: true })
    }
    setLinked({ id: customer.id, snapshot })
  }

  function changeCustomer() {
    // Keep what's typed; the user picks another or edits by hand. Either way
    // the saved customer is no longer the one being billed.
    setLinked(null)
    customerSearchRef.current?.focus()
  }


  // Once issued, an invoice is a document rather than a draft: the number is
  // allocated, the client may already have the PDF, and the server refuses
  // writes. Locking the form here means the user is never invited to make an
  // edit that cannot land.
  const isIssued = status !== 'draft'

  const isDirty = form.formState.isDirty
  const hasClient = Boolean(values.client?.name?.trim())
  const hasLine = computed.lines.some((line) => line.description.trim() && line.taxableMinor > 0)
  // A catalog line in another currency is rejected by the server (no FX), so
  // don't autosave into an error — the line itself says what's wrong.
  const hasCurrencyConflict = values.items.some(
    (item) => item.price && isCurrencyMismatch(item.price_currency, invoiceCurrency),
  )
  const canSave = hasClient && hasLine && !isIssued && !hasCurrencyConflict

  // Debounced autosave. Only runs once the invoice is worth saving — otherwise
  // opening the page would immediately create an empty draft.
  useEffect(() => {
    if (!isDirty || !canSave) return

    const timer = setTimeout(() => save(true), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [values, isDirty, canSave, save])

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
    if (draft.client_city) form.setValue('client.city', draft.client_city, dirty)
    if (draft.client_email) form.setValue('client.email', draft.client_email, dirty)

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
          quantity: String(item.quantity),
          unit: item.unit,
          rate: String(item.rate),
          discount_percent: '0',
          tax_rate: String(item.tax_rate),
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
              instead.
            </p>
          )}

          <fieldset disabled={isIssued} className="space-y-8 disabled:opacity-70">
          {aiEnabled && !isIssued && (
            <AiPanel
              onDraft={applyDraft}
              business={business}
              currency={values.currency || business.currency || 'USD'}
              disabled={isSaving}
            />
          )}

          <Section title="Bill to" description="Who is this invoice for?">
            {!isIssued && (pickers.customers || linked) && (
              <div className="space-y-2">
                {pickers.customers && (
                  <SearchPicker<CustomerOption>
                    label="Search saved customers"
                    placeholder="Search saved customers…"
                    emptyText="No saved customers yet."
                    search={searchCustomers}
                    onPick={pickCustomer}
                    inputRef={customerSearchRef}
                    getKey={(c) => c.id}
                    getLabel={(c) => c.name}
                    renderItem={(c) => (
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{c.name}</span>
                        <span className="truncate text-xs text-muted-foreground">
                          {[c.email, c.city, c.country_code].filter(Boolean).join(' · ') || c.id}
                        </span>
                      </span>
                    )}
                  />
                )}
                {linked && (
                  <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5">
                      <UserRound className="size-3" aria-hidden />
                      Saved customer ·{' '}
                      <span className="font-mono text-foreground">{linked.id}</span>
                    </span>
                    <button
                      type="button"
                      onClick={changeCustomer}
                      className="font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      Change
                    </button>
                    <span>Editing the fields below bills a one-off copy instead.</span>
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Client name" htmlFor="client.name" required className="sm:col-span-2">
                <Input
                  id="client.name"
                  placeholder="Acme Industries"
                  {...form.register('client.name')}
                />
              </Field>

              <Field label="Tax ID" htmlFor="client.tax_id" hint="VAT / EIN, if applicable.">
                <Input
                  id="client.tax_id"
                  placeholder="VAT ID"
                  className="font-mono uppercase"
                  {...form.register('client.tax_id')}
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

              <Field label="Region / State" htmlFor="client.region">
                <Input id="client.region" {...form.register('client.region')} />
              </Field>

              <Field label="Postal code" htmlFor="client.postal_code">
                <Input id="client.postal_code" {...form.register('client.postal_code')} />
              </Field>

              <Field label="Country" htmlFor="client.country_code">
                <select
                  id="client.country_code"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  {...form.register('client.country_code')}
                >
                  {COUNTRIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section
            title="Invoice details"
            description="Dates and currency for this invoice."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Issue date" htmlFor="issue_date" required>
                <Input id="issue_date" type="date" {...form.register('issue_date')} />
              </Field>

              <Field label="Due date" htmlFor="due_date">
                <Input id="due_date" type="date" {...form.register('due_date')} />
              </Field>

              <Field label="Currency" htmlFor="currency" required>
                <select
                  id="currency"
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  {...form.register('currency')}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Line items" description="What are you billing for?">
            <LineItems
              defaultTaxRate={countryDefaults.defaultTaxRate}
              currency={invoiceCurrency}
              catalogEnabled={pickers.prices && !isIssued}
            />
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
      {new Date(savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </span>
  )
}
