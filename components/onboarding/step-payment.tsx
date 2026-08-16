'use client'

import { useActionState } from 'react'

import { savePaymentSettings } from '@/lib/actions/business'
import type { StepState } from '@/lib/form-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { StepFooter } from '@/components/onboarding/step-footer'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { BusinessRow } from '@/lib/database.types'

const DEFAULT_TERMS = 'Payment due within 15 days of the invoice date.'
const DEFAULT_NOTES = 'Thank you for your business.'

export function StepPayment({
  business,
  action = savePaymentSettings,
  standalone = false,
}: {
  business: BusinessRow | null
  action?: (prev: StepState, formData: FormData) => Promise<StepState>
  /** True on the settings page, where there is no wizard to step through. */
  standalone?: boolean
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {})
  const errors = state.fieldErrors ?? {}
  const kept = state.values ?? {}

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Bank name" htmlFor="bank_name" error={errors.bank_name}>
          <Input id="bank_name" name="bank_name" defaultValue={kept.bank_name ?? business?.bank_name ?? ''} placeholder="HDFC Bank" />
        </Field>

        <Field label="Account holder" htmlFor="account_name" error={errors.account_name}>
          <Input
            id="account_name"
            name="account_name"
            defaultValue={kept.account_name ?? business?.account_name ?? ''}
            placeholder="Umbrella Design Studio"
          />
        </Field>

        <Field label="Account number" htmlFor="account_number" error={errors.account_number}>
          <Input
            id="account_number"
            name="account_number"
            defaultValue={kept.account_number ?? business?.account_number ?? ''}
            className="font-mono"
            inputMode="numeric"
          />
        </Field>

        <Field label="IFSC" htmlFor="ifsc" error={errors.ifsc} hint="Eleven characters, like HDFC0001234.">
          <Input
            id="ifsc"
            name="ifsc"
            defaultValue={kept.ifsc ?? business?.ifsc ?? ''}
            placeholder="HDFC0001234"
            maxLength={11}
            className="font-mono uppercase"
            spellCheck={false}
          />
        </Field>

        <Field
          label="UPI ID"
          htmlFor="upi_id"
          error={errors.upi_id}
          hint="Shown on the invoice so clients can pay instantly."
          className="sm:col-span-2"
        >
          <Input
            id="upi_id"
            name="upi_id"
            defaultValue={kept.upi_id ?? business?.upi_id ?? ''}
            placeholder="umbrella@hdfcbank"
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Default payment terms"
          htmlFor="default_terms"
          error={errors.default_terms}
          hint="Prefilled on every new invoice. Editable per invoice."
        >
          <Textarea
            id="default_terms"
            name="default_terms"
            rows={3}
            defaultValue={kept.default_terms ?? business?.default_terms ?? DEFAULT_TERMS}
          />
        </Field>

        <Field label="Default notes" htmlFor="default_notes" error={errors.default_notes}>
          <Textarea
            id="default_notes"
            name="default_notes"
            rows={3}
            defaultValue={kept.default_notes ?? business?.default_notes ?? DEFAULT_NOTES}
          />
        </Field>
      </div>

      <FormError message={state.error} />
      {state.saved && <FormSuccess message="Saved." />}

      {standalone ? (
        <div className="flex justify-end">
          <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
        </div>
      ) : (
        <StepFooter backTo={1} skipFrom={2} />
      )}
    </form>
  )
}
