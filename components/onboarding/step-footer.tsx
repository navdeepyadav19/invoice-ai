'use client'

import { ArrowLeft } from 'lucide-react'

import { goToStep, skipStep } from '@/lib/actions/onboarding'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'

/**
 * Back / Skip / Continue for a wizard step.
 *
 * These live INSIDE the step's form and use `formAction` to point at a different
 * server action, rather than each being its own <form> — nesting forms is
 * invalid HTML and browsers silently drop the inner one. Only the clicked
 * button's name/value is submitted, so both Back and Skip can send `step`
 * without colliding.
 *
 * `formNoValidate` on Back and Skip matters too: without it the browser would
 * refuse to leave the step while a required field is still empty, which is
 * exactly when someone wants to go back.
 */
export function StepFooter({
  backTo,
  skipFrom,
  submitLabel = 'Continue',
  pendingLabel = 'Saving…',
}: {
  backTo?: number
  skipFrom?: number
  submitLabel?: string
  pendingLabel?: string
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
      <div>
        {backTo !== undefined && (
          <Button
            type="submit"
            variant="ghost"
            formAction={goToStep}
            formNoValidate
            name="step"
            value={backTo}
          >
            <ArrowLeft className="size-4" />
            Back
          </Button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {skipFrom !== undefined && (
          <Button
            type="submit"
            variant="ghost"
            className="text-muted-foreground"
            formAction={skipStep}
            formNoValidate
            name="step"
            value={skipFrom}
          >
            Skip for now
          </Button>
        )}

        <SubmitButton size="lg" pendingLabel={pendingLabel}>
          {submitLabel}
        </SubmitButton>
      </div>
    </div>
  )
}
