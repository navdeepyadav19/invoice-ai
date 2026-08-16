'use client'

import { useActionState, useState } from 'react'

import { saveNumberingSettings } from '@/lib/actions/business'
import type { StepState } from '@/lib/form-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { StepFooter } from '@/components/onboarding/step-footer'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { financialYearLabel } from '@/lib/india'
import type { BusinessRow } from '@/lib/database.types'

export function StepNumbering({
  business,
  action = saveNumberingSettings,
  standalone = false,
}: {
  business: BusinessRow | null
  action?: (prev: StepState, formData: FormData) => Promise<StepState>
  standalone?: boolean
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {})
  const errors = state.fieldErrors ?? {}

  const [prefix, setPrefix] = useState(business?.invoice_prefix ?? 'INV')
  const [start, setStart] = useState(String(business?.next_invoice_number ?? 1))

  const fy = financialYearLabel(new Date())
  const padded = String(Math.max(1, Number(start) || 1)).padStart(4, '0')
  const preview = `${prefix || 'INV'}/${fy}/${padded}`

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Prefix"
          htmlFor="invoice_prefix"
          required
          error={errors.invoice_prefix}
          hint="Letters, numbers, hyphens and slashes."
        >
          <Input
            id="invoice_prefix"
            name="invoice_prefix"
            value={prefix}
            onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            maxLength={10}
            className="font-mono uppercase"
            spellCheck={false}
            required
          />
        </Field>

        <Field
          label="Start numbering at"
          htmlFor="next_invoice_number"
          required
          error={errors.next_invoice_number}
          hint="Continuing from another system? Enter your next number."
        >
          <Input
            id="next_invoice_number"
            name="next_invoice_number"
            value={start}
            onChange={(e) => setStart(e.target.value.replace(/[^0-9]/g, ''))}
            inputMode="numeric"
            className="font-mono"
            required
          />
        </Field>
      </div>

      <div className="rounded-lg border border-border bg-muted/40 p-5">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Your first invoice will be numbered
        </p>
        <p className="mt-2 font-mono text-2xl font-semibold tracking-tight">{preview}</p>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          The financial year ({fy}) is inserted automatically and rolls over each April. Numbers are
          assigned when you <em>send</em> an invoice, not when you start a draft — so an abandoned
          draft never leaves a gap in your series.
        </p>
      </div>

      <FormError message={state.error} />
      {state.saved && <FormSuccess message="Saved." />}

      {standalone ? (
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </div>
      ) : (
        <StepFooter backTo={2} skipFrom={3} submitLabel="Finish setup" pendingLabel="Finishing…" />
      )}
    </form>
  )
}
