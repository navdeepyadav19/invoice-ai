'use client'

import { AlertTriangle, BookOpen, Link2Off, Package, Plus, Trash2 } from 'lucide-react'
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
import { SearchPicker } from '@/components/invoice/search-picker'
import { searchPrices } from '@/lib/actions/catalog-search'
import {
  formatPriceLabel,
  isBlankLine,
  isCurrencyMismatch,
  priceToLineItem,
  type PriceOption,
} from '@/lib/catalog/picker'
import { UNITS } from '@/lib/units'
import { emptyLineItem, type InvoiceFormValues } from '@/lib/invoice-form'

export function LineItems({
  defaultTaxRate = 0,
  currency,
  catalogEnabled = false,
}: {
  defaultTaxRate?: number
  /** The invoice currency — catalog prices in any other currency can't be added. */
  currency: string
  /** Show "Add from catalog". Off for guests and when there are no active prices. */
  catalogEnabled?: boolean
}) {
  const { control, register, watch, setValue, getValues } = useFormContext<InvoiceFormValues>()
  const { fields, append, remove, update } = useFieldArray({ control, name: 'items' })

  function addPrice(price: PriceOption) {
    // Belt and braces: the picker already disables these rows.
    if (isCurrencyMismatch(price.currency, currency)) return

    const line = priceToLineItem(price)
    const items = getValues('items')
    // Swap out the untouched starter row instead of leaving an empty line
    // above the one the user actually wanted.
    if (items.length === 1 && isBlankLine(items[0])) {
      update(0, line)
    } else {
      append(line)
    }
  }

  function unlinkPrice(index: number) {
    // Keep what the line says; drop only the catalog reference.
    const dirty = { shouldDirty: true } as const
    setValue(`items.${index}.price`, undefined, dirty)
    setValue(`items.${index}.price_currency`, undefined, dirty)
    setValue(`items.${index}.price_label`, undefined, dirty)
  }

  return (
    <div className="space-y-3">
      {fields.map((field, index) => (
        <div
          key={field.id}
          className="rounded-lg border border-border bg-card p-4 transition-colors focus-within:border-primary/40"
        >
          <div className="flex items-start gap-3">
            <div className="flex-1 space-y-3">
              <CatalogBadge
                price={watch(`items.${index}.price`)}
                label={watch(`items.${index}.price_label`)}
                priceCurrency={watch(`items.${index}.price_currency`)}
                currency={currency}
                onUnlink={() => unlinkPrice(index)}
              />
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

                <div className="space-y-1.5">
                  <Label htmlFor={`items.${index}.tax_rate`} className="text-xs">
                    Tax %
                  </Label>
                  <Input
                    id={`items.${index}.tax_rate`}
                    inputMode="decimal"
                    placeholder="0"
                    className="font-mono"
                    {...register(`items.${index}.tax_rate`)}
                  />
                </div>
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => append(emptyLineItem(defaultTaxRate))}>
          <Plus className="size-4" />
          Add line item
        </Button>

        {catalogEnabled && (
          <SearchPicker<PriceOption>
            variant="button"
            trigger={
              <>
                <BookOpen aria-hidden />
                Add from catalog
              </>
            }
            label="Search catalog prices"
            placeholder="Search products or price nicknames…"
            emptyText="No active prices yet."
            search={searchPrices}
            onPick={addPrice}
            getKey={(p) => p.id}
            getLabel={(p) => p.productName}
            isItemDisabled={(p) => isCurrencyMismatch(p.currency, currency)}
            renderItem={(p) => <PriceRow price={p} invoiceCurrency={currency} />}
          />
        )}
      </div>
    </div>
  )
}

function PriceRow({ price, invoiceCurrency }: { price: PriceOption; invoiceCurrency: string }) {
  const mismatch = isCurrencyMismatch(price.currency, invoiceCurrency)

  return (
    <span className="flex min-w-0 flex-1 items-start gap-2">
      <Package className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-medium">{price.productName}</span>
          <span className="shrink-0 font-mono text-xs">{formatPriceLabel(price)}</span>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {mismatch
            ? `${price.currency} — invoice is in ${invoiceCurrency}`
            : [price.nickname, price.currency, price.taxRate ? `${price.taxRate}% tax` : null]
                .filter(Boolean)
                .join(' · ')}
        </span>
      </span>
    </span>
  )
}

function CatalogBadge({
  price,
  label,
  priceCurrency,
  currency,
  onUnlink,
}: {
  price?: string
  label?: string
  priceCurrency?: string
  currency: string
  onUnlink: () => void
}) {
  if (!price) return null
  const mismatch = isCurrencyMismatch(priceCurrency, currency)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2 py-0.5">
          <Package className="size-3" aria-hidden />
          Catalog{label ? ` · ${label}` : ''}
        </span>
        <button
          type="button"
          onClick={onUnlink}
          className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-4 hover:underline"
        >
          <Link2Off className="size-3" aria-hidden />
          Unlink
        </button>
      </div>
      {mismatch && (
        <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
          This catalog price is in {priceCurrency}, but the invoice is in {currency}. Switch the
          invoice currency back or unlink the line to keep it as a one-off amount. Saving is paused
          until then.
        </p>
      )}
    </div>
  )
}
