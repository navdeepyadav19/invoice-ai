'use client'

import { useActionState } from 'react'

import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { updateProductAction } from '@/lib/actions/products'
import { keptValues, type StepState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'

export function ProductDetailsForm({
  productId,
  name,
  description,
}: {
  /** `prod_…` */
  productId: string
  name: string
  description: string | null
}) {
  const [state, formAction] = useActionState<StepState, FormData>(
    updateProductAction.bind(null, productId),
    {},
  )
  const formKey = useSubmissionKey(state)
  const kept = keptValues(state.values)
  const errors = state.fieldErrors ?? {}

  return (
    <form key={formKey} action={formAction} className="space-y-5">
      <Field label="Name" htmlFor="product-name" required error={errors.name}>
        <Input
          id="product-name"
          name="name"
          defaultValue={kept.text('name', name)}
          aria-invalid={Boolean(errors.name)}
          required
        />
      </Field>
      <Field label="Description" htmlFor="product-description" error={errors.description}>
        <Textarea
          id="product-description"
          name="description"
          defaultValue={kept.text('description', description)}
          rows={3}
        />
      </Field>

      <FormError message={state.error} />
      {state.saved && <FormSuccess message="Saved." />}

      <div className="flex justify-end">
        <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
      </div>
    </form>
  )
}
