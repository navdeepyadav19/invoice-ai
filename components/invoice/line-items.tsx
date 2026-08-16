'use client'

import { Plus, Trash2 } from 'lucide-react'
import { useFieldArray, useFormContext } from 'react-hook-form'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { GST_RATES, UNITS } from '@/lib/india'
import { emptyLineItem, type InvoiceFormValues } from '@/lib/invoice-form'

export function LineItems({ showTax }: { showTax: boolean }) {
  const { control, register, watch, setValue } = useFormContext<InvoiceFormValues>()
  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="rounded-lg border border-border bg-card p-4 transition-colors focus-within:border-primary/40"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3">
              <div className="grid gap-3 sm:grid-cols-[1fr_9rem]">
                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.description`} className="text-xs">
                    Description
                  </Label>
                  <Input
                    id={`items.${index}.description`}
                    placeholder="Brand identity design"
                    {...register(`items.${index}.description`)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.hsn_sac`} className="text-xs">
                    HSN / SAC
                  </Label>
                  <Input
                    id={`items.${index}.hsn_sac`}
                    placeholder="998912"
                    inputMode="numeric"
                    className="font-mono"
                    {...register(`items.${index}.hsn_sac`)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.quantity`} className="text-xs">
                    Qty
                  </Label>
                  <Input
                    id={`items.${index}.quantity`}
                    inputMode="decimal"
                    className="font-mono"
                    {...register(`items.${index}.quantity`)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.unit`} className="text-xs">
                    Unit
                  </Label>
                  <Select
                    value={watch(`items.${index}.unit`)}
                    onValueChange={(value) => setValue(`items.${index}.unit`, value ?? 'NOS')}
                  >
                    <SelectTrigger id={`items.${index}.unit`} className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {UNITS.map((unit) => (
                        <SelectItem key={unit} value={unit}>
                          {unit}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.rate`} className="text-xs">
                    Rate
                  </Label>
                  <Input
                    id={`items.${index}.rate`}
                    inputMode="decimal"
                    placeholder="0.00"
                    className="font-mono"
                    {...register(`items.${index}.rate`)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.discount_percent`} className="text-xs">
                    Disc %
                  </Label>
                  <Input
                    id={`items.${index}.discount_percent`}
                    inputMode="decimal"
                    className="font-mono"
                    {...register(`items.${index}.discount_percent`)}
                  />
                </div>

                {showTax && (
                  <div className="space-y-1.5">
                    <Label htmlFor={`items.${index}.gst_rate`} className="text-xs">
                      GST %
                    </Label>
                    <Select
                      value={watch(`items.${index}.gst_rate`)}
                      onValueChange={(value) => setValue(`items.${index}.gst_rate`, value ?? '18')}
                    >
                      <SelectTrigger id={`items.${index}.gst_rate`} className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {GST_RATES.map((rate) => (
                          <SelectItem key={rate} value={String(rate)}>
                            {rate}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="mt-6 text-muted-foreground hover:text-destructive"
              // Never leave the form with zero rows: an invoice with no lines
              // can't be saved, and an empty list gives the user nothing to
              // click to get back to a usable state.
              disabled={fields.length === 1}
              onClick={() => remove(index)}
              aria-label={`Remove line ${index + 1}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={() => append(emptyLineItem())}>
        <Plus className="size-4" />
        Add line item
      </Button>
    </div>
  )
}
