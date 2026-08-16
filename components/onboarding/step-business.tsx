'use client'

import { useActionState, useState } from 'react'

import { saveBusinessSettings } from '@/lib/actions/business'
import type { StepState } from '@/lib/form-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { GST_STATES, stateName } from '@/lib/india'
import { GSTIN_REGEX, stateCodeFromGstin } from '@/lib/validators'
import type { BusinessRow } from '@/lib/database.types'

type StepAction = (prev: StepState, formData: FormData) => Promise<StepState>

export function StepBusiness({
  business,
  action = saveBusinessSettings,
  submitLabel = 'Continue',
}: {
  business: BusinessRow | null
  /** Settings passes its own action so the same form doesn't advance the wizard. */
  action?: StepAction
  submitLabel?: string
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {})

  const [isRegistered, setIsRegistered] = useState(business?.is_gst_registered ?? true)
  const [gstin, setGstin] = useState(business?.gstin ?? '')
  const [stateCode, setStateCode] = useState(business?.state_code ?? '')

  const errors = state.fieldErrors ?? {}
  const kept = state.values ?? {}

  /**
   * A GSTIN already contains the state, so once a complete one is typed we set
   * the dropdown from it. That turns the most common validation failure — a
   * GSTIN and a state that disagree — into something the user can't easily hit.
   */
  function handleGstinChange(value: string) {
    const next = value.toUpperCase()
    setGstin(next)

    if (GSTIN_REGEX.test(next)) {
      const derived = stateCodeFromGstin(next)
      if (derived) setStateCode(derived)
    }
  }

  return (
    <form action={formAction} className="space-y-6">
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
            defaultValue={kept.legal_name ?? business?.legal_name ?? ''}
            placeholder="Umbrella Design Studio"
            required
          />
        </Field>

        <Field
          label="Trade name"
          htmlFor="trade_name"
          error={errors.trade_name}
          hint="Optional — the name clients know you by."
          className="sm:col-span-2"
        >
          <Input
            id="trade_name"
            name="trade_name"
            defaultValue={kept.trade_name ?? business?.trade_name ?? ''}
            placeholder="Umbrella"
          />
        </Field>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">I&rsquo;m registered for GST</p>
            <p className="text-xs text-muted-foreground">
              Turn this off and we&rsquo;ll issue a Bill of Supply with no tax columns.
            </p>
          </div>
          <Switch
            id="is_gst_registered"
            name="is_gst_registered"
            checked={isRegistered}
            onCheckedChange={setIsRegistered}
          />
        </div>

        {isRegistered && (
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field
              label="GSTIN"
              htmlFor="gstin"
              required
              error={errors.gstin}
              hint="15 characters. We check the checksum, so a typo won't slip through."
            >
              <Input
                id="gstin"
                name="gstin"
                value={gstin}
                onChange={(event) => handleGstinChange(event.target.value)}
                placeholder="27AAPFU0939F1ZV"
                maxLength={15}
                className="font-mono uppercase"
                autoCapitalize="characters"
                spellCheck={false}
              />
            </Field>

            <Field label="PAN" htmlFor="pan" error={errors.pan} hint="Optional.">
              <Input
                id="pan"
                name="pan"
                defaultValue={kept.pan ?? business?.pan ?? ''}
                placeholder="AAPFU0939F"
                maxLength={10}
                className="font-mono uppercase"
                spellCheck={false}
              />
            </Field>
          </div>
        )}
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
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
            defaultValue={kept.address_line1 ?? business?.address_line1 ?? ''}
            placeholder="4th Floor, Trade Centre, Bandra Kurla Complex"
            required
          />
        </Field>

        <Field label="Address line 2" htmlFor="address_line2" error={errors.address_line2}>
          <Input
            id="address_line2"
            name="address_line2"
            defaultValue={kept.address_line2 ?? business?.address_line2 ?? ''}
          />
        </Field>

        <Field label="City" htmlFor="city" required error={errors.city}>
          <Input id="city" name="city" defaultValue={kept.city ?? business?.city ?? ''} placeholder="Mumbai" required />
        </Field>

        <Field
          label="State"
          htmlFor="state_code"
          required
          error={errors.state_code}
          hint="This decides whether your invoices charge CGST+SGST or IGST."
        >
          <Select
            name="state_code"
            value={stateCode}
            onValueChange={(value) => setStateCode(value ?? '')}
            required
          >
            <SelectTrigger id="state_code" className="w-full">
              {/* Base UI's Select.Value renders the raw value by default, so the
                  trigger would read "27" once a state is picked. The render
                  function puts the name back. */}
              <SelectValue placeholder="Select your state">
                {(value) =>
                  value ? `${value} — ${stateName(String(value))}` : 'Select your state'
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

        <Field label="PIN code" htmlFor="pincode" error={errors.pincode}>
          <Input
            id="pincode"
            name="pincode"
            defaultValue={kept.pincode ?? business?.pincode ?? ''}
            placeholder="400051"
            maxLength={6}
            inputMode="numeric"
          />
        </Field>

        <Field label="Contact email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={kept.email ?? business?.email ?? ''}
            placeholder="billing@umbrella.in"
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={kept.phone ?? business?.phone ?? ''}
            placeholder="+91 98200 00000"
          />
        </Field>
      </div>

      <FormError message={state.error} />
      {state.saved && <FormSuccess message="Saved." />}

      <div className="flex justify-end">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
      </div>
    </form>
  )
}
