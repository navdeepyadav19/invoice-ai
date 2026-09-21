'use client'

import { useState } from 'react'

import { Field } from '@/components/onboarding/field'
import { Input } from '@/components/ui/input'
import { currencyDecimals } from '@/lib/catalog/price-format'
import { CURRENCIES } from '@/lib/locale/countries'
import { cn } from '@/lib/utils'
import type { KeptValues } from '@/lib/form-state'

const SELECT_CLASS =
  'h-8 w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'

const INTERVALS = [
  { value: 'day', label: 'day(s)' },
  { value: 'week', label: 'week(s)' },
  { value: 'month', label: 'month(s)' },
  { value: 'year', label: 'year(s)' },
] as const

/**
 * The fields of a new price: amount + currency, one-off vs recurring, nickname,
 * tax rate. Uncontrolled except for the two choices that change what else is
 * shown; all defaults come from `kept` so a failed submit restores them (the
 * parent form remounts via useSubmissionKey).
 */
export function PriceFields({
  kept,
  errors,
  defaultCurrency,
  idPrefix = 'price',
}: {
  kept: KeptValues
  errors: Record<string, string>
  defaultCurrency: string
  idPrefix?: string
}) {
  const [currency, setCurrency] = useState(kept.text('currency', defaultCurrency))
  const [type, setType] = useState(kept.text('type', 'one_time'))
  const id = (name: string) => `${idPrefix}-${name}`
  const decimals = currencyDecimals(currency)
  const currencies = CURRENCIES.includes(currency) ? CURRENCIES : [currency, ...CURRENCIES]

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <Field
        label="Amount"
        htmlFor={id('unit_amount')}
        required
        error={errors.unit_amount}
        hint={
          decimals === 0
            ? `${currency} has no minor unit — whole amounts only.`
            : `In ${currency}, e.g. 2500 or 49.99.`
        }
      >
        <Input
          id={id('unit_amount')}
          name="unit_amount"
          inputMode="decimal"
          autoComplete="off"
          defaultValue={kept.text('unit_amount')}
          placeholder={decimals === 0 ? '5000' : '0.00'}
          aria-invalid={Boolean(errors.unit_amount)}
          className="font-mono tabular-nums"
          required
        />
      </Field>

      <Field label="Currency" htmlFor={id('currency')} required error={errors.currency}>
        <select
          id={id('currency')}
          name="currency"
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          className={SELECT_CLASS}
          required
        >
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Field>

      <fieldset className="space-y-2 sm:col-span-2">
        <legend className="text-sm font-medium">Billing</legend>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'one_time', title: 'One-off', note: 'Charged once per invoice line' },
            { value: 'recurring', title: 'Recurring', note: 'Charged every period' },
          ].map((option) => (
            <label
              key={option.value}
              className={cn(
                'flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 text-sm transition-colors',
                type === option.value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/40',
              )}
            >
              <input
                type="radio"
                name="type"
                value={option.value}
                checked={type === option.value}
                onChange={() => setType(option.value)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="block font-medium">{option.title}</span>
                <span className="block text-xs text-muted-foreground">{option.note}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {type === 'recurring' ? (
        <Field
          label="Billing period"
          htmlFor={id('interval_count')}
          required
          error={errors.recurring_interval ?? errors.interval_count}
          hint="Recorded on the price; nothing is auto-billed yet."
          className="sm:col-span-2"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Every</span>
            <Input
              id={id('interval_count')}
              name="interval_count"
              type="number"
              min={1}
              max={52}
              step={1}
              defaultValue={kept.text('interval_count', 1)}
              className="w-20 font-mono tabular-nums"
            />
            <select
              aria-label="Interval"
              name="recurring_interval"
              defaultValue={kept.text('recurring_interval', 'month')}
              className={cn(SELECT_CLASS, 'w-36')}
            >
              {INTERVALS.map((i) => (
                <option key={i.value} value={i.value}>
                  {i.label}
                </option>
              ))}
            </select>
          </div>
        </Field>
      ) : null}

      <Field
        label="Nickname"
        htmlFor={id('nickname')}
        error={errors.nickname}
        hint="Optional, internal — e.g. “Monthly (India)”."
      >
        <Input id={id('nickname')} name="nickname" defaultValue={kept.text('nickname')} />
      </Field>

      <Field label="Tax rate (%)" htmlFor={id('tax_rate')} error={errors.tax_rate} hint="0 if none.">
        <Input
          id={id('tax_rate')}
          name="tax_rate"
          type="number"
          min={0}
          max={100}
          step="0.01"
          defaultValue={kept.text('tax_rate', 0)}
          className="font-mono tabular-nums"
        />
      </Field>
    </div>
  )
}
