'use client'

import { useActionState } from 'react'

import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { keptValues, type StepState } from '@/lib/form-state'
import { COUNTRIES } from '@/lib/locale/countries'
import { useSubmissionKey } from '@/lib/use-submission-key'
import type { ClientRow } from '@/lib/database.types'

type CustomerAction = (prev: StepState, formData: FormData) => Promise<StepState>

/**
 * Create and edit share this form. Values come from the saved row until a
 * submission fails, then from the echoed submission (keptValues), and the form
 * remounts per result (useSubmissionKey) so React's post-action reset can't
 * wipe what was typed.
 */
export function CustomerForm({
  customer,
  action,
  submitLabel,
}: {
  customer?: ClientRow | null
  action: CustomerAction
  submitLabel: string
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {})
  const formKey = useSubmissionKey(state)

  const errors = state.fieldErrors ?? {}
  const kept = keptValues(state.values)

  return (
    <form key={formKey} action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Name" htmlFor="name" required error={errors.name} className="sm:col-span-2">
          <Input
            id="name"
            name="name"
            defaultValue={kept.text('name', customer?.name)}
            placeholder="Acme Industries"
            aria-invalid={Boolean(errors.name) || undefined}
            required
          />
        </Field>

        <Field label="Email" htmlFor="email" error={errors.email} hint="Where invoices are sent.">
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={kept.text('email', customer?.email)}
            placeholder="accounts@acme.com"
            aria-invalid={Boolean(errors.email) || undefined}
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={kept.text('phone', customer?.phone)}
            placeholder="+1 512 000 0000"
          />
        </Field>

        <Field
          label="Tax ID"
          htmlFor="tax_id"
          error={errors.tax_id}
          hint="Optional — VAT, EIN, ABN, GSTIN, whatever their country uses."
          className="sm:col-span-2"
        >
          <Input
            id="tax_id"
            name="tax_id"
            defaultValue={kept.text('tax_id', customer?.tax_id ?? customer?.gstin)}
            placeholder="VAT ID"
            className="font-mono uppercase"
            spellCheck={false}
          />
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Address" htmlFor="address_line1" error={errors.address_line1} className="sm:col-span-2">
          <Input
            id="address_line1"
            name="address_line1"
            defaultValue={kept.text('address_line1', customer?.address_line1)}
            placeholder="100 Market Street"
          />
        </Field>

        <Field label="Address line 2" htmlFor="address_line2" error={errors.address_line2} className="sm:col-span-2">
          <Input
            id="address_line2"
            name="address_line2"
            defaultValue={kept.text('address_line2', customer?.address_line2)}
            placeholder="Suite 400"
          />
        </Field>

        <Field label="City" htmlFor="city" error={errors.city}>
          <Input id="city" name="city" defaultValue={kept.text('city', customer?.city)} />
        </Field>

        <Field label="Region / State" htmlFor="region" error={errors.region}>
          <Input id="region" name="region" defaultValue={kept.text('region', customer?.region)} />
        </Field>

        <Field label="Postal code" htmlFor="postal_code" error={errors.postal_code}>
          <Input
            id="postal_code"
            name="postal_code"
            defaultValue={kept.text('postal_code', customer?.postal_code ?? customer?.pincode)}
          />
        </Field>

        <Field label="Country" htmlFor="country_code" error={errors.country_code}>
          <select
            id="country_code"
            name="country_code"
            defaultValue={kept.text('country_code', customer?.country_code)}
            className="h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm"
            aria-invalid={Boolean(errors.country_code) || undefined}
          >
            <option value="">—</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <FormError message={state.error} />
      {state.saved && <FormSuccess message="Saved." />}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
      </div>
    </form>
  )
}
