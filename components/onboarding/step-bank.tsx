'use client'

import { useActionState } from 'react'
import { Info } from 'lucide-react'

import { saveBankStep } from '@/lib/actions/onboarding'
import { keptValues, type StepState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'
import { FormError } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { StepFooter } from '@/components/onboarding/step-footer'
import { Input } from '@/components/ui/input'
import type { BusinessRow } from '@/lib/database.types'

/**
 * The whole of step two: three fields.
 *
 * Everything that used to be here — payment terms, default notes, invoice
 * numbering, logo, signature — moved to settings. They all have workable
 * defaults, and none of them is worth standing between someone and their first
 * invoice.
 */
export function StepBank({ business }: { business: BusinessRow | null }) {
  const [state, formAction] = useActionState<StepState, FormData>(saveBankStep, {})
  const errors = state.fieldErrors ?? {}

  // React resets the form after the action runs, including on a failed
  // validation. Seeding defaultValue from the echoed submission and remounting
  // the form per result means nothing they typed is lost.
  const kept = keptValues(state.values)
  const formKey = useSubmissionKey(state)

  return (
    <form key={formKey} action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Account name"
          htmlFor="account_name"
          error={errors.account_name}
          hint="The name the account is held in."
          className="sm:col-span-2"
        >
          <Input
            id="account_name"
            name="account_name"
            defaultValue={kept.text('account_name', business?.account_name ?? business?.legal_name)}
            placeholder="Umbrella Design Studio LLC"
          />
        </Field>

        <Field label="Account number" htmlFor="account_number" error={errors.account_number}>
          <Input
            id="account_number"
            name="account_number"
            defaultValue={kept.text('account_number', business?.account_number)}
            placeholder="123456789"
            className="font-mono"
            inputMode="numeric"
            autoComplete="off"
          />
        </Field>

        <Field
          label="Routing number"
          htmlFor="routing_number"
          error={errors.routing_number}
          hint="Bank or branch code, whatever your country uses."
        >
          <Input
            id="routing_number"
            name="routing_number"
            defaultValue={kept.text('routing_number', business?.routing_number)}
            placeholder="111000025"
            className="font-mono uppercase"
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
      </div>

      <p className="flex items-start gap-2 rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        These are printed at the foot of every invoice so your client can pay without asking. Add
        payment terms or a different invoice number format any time from settings.
      </p>

      <FormError message={state.error} />

      <StepFooter backTo={1} skipFrom={2} submitLabel="Finish setup" pendingLabel="Finishing…" />
    </form>
  )
}
