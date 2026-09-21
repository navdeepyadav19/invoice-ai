'use client'

import { useActionState, useState } from 'react'

import { saveBusinessSettings } from '@/lib/actions/business'
import type { StepState } from '@/lib/form-state'
import { FormError, FormSuccess } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { SubmitButton } from '@/components/submit-button'
import { Input } from '@/components/ui/input'
import { COUNTRIES, CURRENCIES, countryByCode } from '@/lib/locale/countries'
import type { BusinessRow } from '@/lib/database.types'

type StepAction = (prev: StepState, formData: FormData) => Promise<StepState>

export function StepBusiness({
  business,
  action = saveBusinessSettings,
  submitLabel = 'Continue',
  detectedCountry,
}: {
  business: BusinessRow | null
  /** Settings passes its own action so the same form doesn't advance the wizard. */
  action?: StepAction
  submitLabel?: string
  /** ISO country from the request IP — a default, not a decision. */
  detectedCountry?: string
}) {
  const [state, formAction] = useActionState<StepState, FormData>(action, {})

  const initialCountry = business?.country_code ?? detectedCountry ?? 'US'
  const [countryCode, setCountryCode] = useState(initialCountry)
  const [currency, setCurrency] = useState(
    business?.currency ?? countryByCode(initialCountry).currency,
  )

  const errors = state.fieldErrors ?? {}
  const kept = state.values ?? {}

  function handleCountryChange(code: string) {
    setCountryCode(code)
    // Keep currency in sync only when the user hasn't customised it away from
    // the previous country's default — an explicit choice must survive.
    setCurrency((prev) => {
      const prevDefault = countryByCode(countryCode).currency
      if (prev === prevDefault) return countryByCode(code).currency
      return prev
    })
  }

  return (
    <form action={formAction} className="space-y-6">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Business name"
          htmlFor="legal_name"
          required
          error={errors.legal_name}
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

        <Field label="Country" htmlFor="country_code" required error={errors.country_code}>
          <select
            id="country_code"
            name="country_code"
            value={countryCode}
            onChange={(e) => handleCountryChange(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          >
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Currency"
          htmlFor="currency"
          required
          error={errors.currency}
          hint="Default for new invoices. Each invoice can override it."
        >
          <select
            id="currency"
            name="currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            required
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Tax ID"
          htmlFor="tax_id"
          error={errors.tax_id}
          hint="Optional — VAT, EIN, ABN, GSTIN, whatever your country uses."
          className="sm:col-span-2"
        >
          <Input
            id="tax_id"
            name="tax_id"
            defaultValue={kept.tax_id ?? business?.tax_id ?? ''}
            placeholder="VAT ID"
            className="font-mono uppercase"
            spellCheck={false}
          />
        </Field>
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
            placeholder="4th Floor, Trade Centre"
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
          <Input id="city" name="city" defaultValue={kept.city ?? business?.city ?? ''} placeholder="Austin" required />
        </Field>

        <Field label="Region / State" htmlFor="region" error={errors.region}>
          <Input
            id="region"
            name="region"
            defaultValue={kept.region ?? business?.region ?? ''}
            placeholder="TX"
          />
        </Field>

        <Field label="Postal code" htmlFor="postal_code" error={errors.postal_code}>
          <Input
            id="postal_code"
            name="postal_code"
            defaultValue={kept.postal_code ?? business?.postal_code ?? business?.pincode ?? ''}
            placeholder="73301"
          />
        </Field>

        <Field label="Contact email" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            defaultValue={kept.email ?? business?.email ?? ''}
            placeholder="billing@umbrella.co"
          />
        </Field>

        <Field label="Phone" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={kept.phone ?? business?.phone ?? ''}
            placeholder="+1 512 000 0000"
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
