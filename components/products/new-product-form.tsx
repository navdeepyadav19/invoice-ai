'use client'

import Link from 'next/link'
import { useActionState } from 'react'

import { FormError } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { PriceFields } from '@/components/products/price-fields'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { createProductAction } from '@/lib/actions/products'
import { keptValues, type StepState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'

/** A product and its first price, saved together. Success redirects to the product. */
export function NewProductForm({ defaultCurrency }: { defaultCurrency: string }) {
  const [state, formAction] = useActionState<StepState, FormData>(createProductAction, {})
  // Remount per result so React's post-action form reset can't wipe input.
  const formKey = useSubmissionKey(state)
  const kept = keptValues(state.values)
  const errors = state.fieldErrors ?? {}

  return (
    <form key={formKey} action={formAction} className="space-y-8">
      <section className="space-y-5 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-medium">Product</h2>
        <Field label="Name" htmlFor="name" required error={errors.name}>
          <Input
            id="name"
            name="name"
            defaultValue={kept.text('name')}
            placeholder="Brand design retainer"
            aria-invalid={Boolean(errors.name)}
            required
          />
        </Field>
        <Field
          label="Description"
          htmlFor="description"
          error={errors.description}
          hint="Optional — shown to you, and on invoice lines that use this product."
        >
          <Textarea id="description" name="description" defaultValue={kept.text('description')} rows={3} />
        </Field>
      </section>

      <section className="space-y-5 rounded-xl border border-border bg-card p-5">
        <div>
          <h2 className="text-sm font-medium">Price</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            The first way to charge for this product. You can add more later — another currency, a
            yearly plan.
          </p>
        </div>
        <PriceFields kept={kept} errors={errors} defaultCurrency={defaultCurrency} idPrefix="new-price" />
      </section>

      <FormError message={state.error} />

      <div className="flex justify-end gap-2">
        <Button variant="outline" nativeButton={false} render={<Link href="/products" />}>
          Cancel
        </Button>
        <SubmitButton pendingLabel="Saving…">Save product</SubmitButton>
      </div>
    </form>
  )
}
