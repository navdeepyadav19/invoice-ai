'use client'

import { useActionState, useState } from 'react'
import { Archive, Lock, Pencil, Plus, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'

import { FormError } from '@/components/auth/form-error'
import { Field } from '@/components/onboarding/field'
import { CatalogStatus } from '@/components/products/catalog-status'
import { ConfirmAction } from '@/components/products/confirm-action'
import { PriceFields } from '@/components/products/price-fields'
import { SubmitButton } from '@/components/submit-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  createPriceAction,
  setPriceActiveAction,
  setProductActiveAction,
  updatePriceAction,
} from '@/lib/actions/products'
import { describeBilling, formatAmount } from '@/lib/catalog/price-format'
import { keptValues, type StepState } from '@/lib/form-state'
import { useSubmissionKey } from '@/lib/use-submission-key'
import type { PriceRow } from '@/lib/database.types'

export function PricesSection({
  productId,
  defaultCurrency,
  prices,
}: {
  /** `prod_…` */
  productId: string
  defaultCurrency: string
  prices: PriceRow[]
}) {
  // Active first, then newest — archived prices stay visible for reference.
  const sorted = [...prices].sort(
    (a, b) => Number(b.active) - Number(a.active) || b.created_at.localeCompare(a.created_at),
  )

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-medium">Prices</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Each price is one way to charge for this product — a currency, an amount, a billing period.
          </p>
        </div>
        <AddPriceDialog productId={productId} defaultCurrency={defaultCurrency} />
      </div>

      {sorted.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          No prices yet. Add one to use this product on invoices.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-[0.1em] text-muted-foreground">
              <tr>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Billing</th>
                <th className="px-5 py-3 font-medium">Nickname</th>
                <th className="px-5 py-3 text-right font-medium">Tax</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((price) => (
                <tr
                  key={price.id}
                  className="border-b border-border/60 last:border-0 hover:bg-muted/30 data-[archived]:text-muted-foreground"
                  data-archived={price.active ? undefined : ''}
                >
                  <td className="px-5 py-3">
                    <div className="font-mono font-medium tabular-nums">
                      {formatAmount(price.unit_amount, price.currency)}{' '}
                      <span className="text-xs text-muted-foreground">{price.currency}</span>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">{price.public_id}</div>
                  </td>
                  <td className="px-5 py-3">{describeBilling(price)}</td>
                  <td className="px-5 py-3">{price.nickname ?? <span className="text-muted-foreground">—</span>}</td>
                  <td className="px-5 py-3 text-right font-mono tabular-nums">{Number(price.tax_rate)}%</td>
                  <td className="px-5 py-3">
                    <CatalogStatus active={price.active} />
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex justify-end gap-1">
                      <EditPriceDialog productId={productId} price={price} />
                      <PriceStatusButton productId={productId} price={price} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AddPriceDialog({ productId, defaultCurrency }: { productId: string; defaultCurrency: string }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState<StepState, FormData>(async (prev, formData) => {
    const result = await createPriceAction(productId, prev, formData)
    if (result.saved) {
      setOpen(false)
      toast.success('Price added.')
    }
    return result
  }, {})
  const formKey = useSubmissionKey(state)
  const kept = keptValues(state.values)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus />
        Add price
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a price</DialogTitle>
          <DialogDescription>
            A new currency, amount or billing period. Existing prices and the invoices that use them
            are unaffected.
          </DialogDescription>
        </DialogHeader>
        <form key={formKey} action={formAction} className="space-y-5">
          <PriceFields
            kept={kept}
            errors={state.fieldErrors ?? {}}
            defaultCurrency={defaultCurrency}
            idPrefix="add-price"
          />
          <FormError message={state.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <SubmitButton pendingLabel="Adding…">Add price</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditPriceDialog({ productId, price }: { productId: string; price: PriceRow }) {
  const [open, setOpen] = useState(false)
  const [state, formAction] = useActionState<StepState, FormData>(async (prev, formData) => {
    const result = await updatePriceAction(productId, price.public_id, prev, formData)
    if (result.saved) {
      setOpen(false)
      toast.success('Price updated.')
    }
    return result
  }, {})
  const formKey = useSubmissionKey(state)
  const kept = keptValues(state.values)
  const errors = state.fieldErrors ?? {}
  const idPrefix = `edit-${price.public_id}`

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Edit price" />}>
        <Pencil />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit price</DialogTitle>
          <DialogDescription className="font-mono text-xs">{price.public_id}</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border border-border bg-muted/40 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="font-mono font-medium tabular-nums">
              {formatAmount(price.unit_amount, price.currency)} {price.currency}
            </span>
            <span className="text-xs text-muted-foreground">{describeBilling(price)}</span>
          </div>
          <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
            <Lock className="mt-0.5 size-3 shrink-0" />
            <span>
              Amount, currency and billing period can&rsquo;t change once a price exists, so invoices
              already issued with it keep meaning what they said. To charge something different, add a
              new price and archive this one.
            </span>
          </p>
        </div>

        <form key={formKey} action={formAction} className="space-y-5">
          <Field
            label="Nickname"
            htmlFor={`${idPrefix}-nickname`}
            error={errors.nickname}
            hint="Leave empty to remove it."
          >
            <Input
              id={`${idPrefix}-nickname`}
              name="nickname"
              defaultValue={kept.text('nickname', price.nickname)}
            />
          </Field>
          <Field label="Tax rate (%)" htmlFor={`${idPrefix}-tax_rate`} error={errors.tax_rate}>
            <Input
              id={`${idPrefix}-tax_rate`}
              name="tax_rate"
              type="number"
              min={0}
              max={100}
              step="0.01"
              defaultValue={kept.text('tax_rate', Number(price.tax_rate))}
              className="font-mono tabular-nums"
            />
          </Field>
          <FormError message={state.error} />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PriceStatusButton({ productId, price }: { productId: string; price: PriceRow }) {
  const label = `${formatAmount(price.unit_amount, price.currency)} ${describeBilling(price).toLowerCase()}`

  return price.active ? (
    <ConfirmAction
      trigger={<Button variant="ghost" size="icon-sm" aria-label="Archive price" />}
      title="Archive this price?"
      description={`${label} won't be offered for new invoices. Invoices that already use it are unchanged, and you can restore it any time.`}
      confirmLabel="Archive price"
      successMessage="Price archived."
      destructive
      run={() => setPriceActiveAction(productId, price.public_id, false)}
    >
      <Archive />
    </ConfirmAction>
  ) : (
    <ConfirmAction
      trigger={<Button variant="ghost" size="icon-sm" aria-label="Restore price" />}
      title="Restore this price?"
      description={`${label} will be available for new invoices again.`}
      confirmLabel="Restore price"
      successMessage="Price restored."
      run={() => setPriceActiveAction(productId, price.public_id, true)}
    >
      <RotateCcw />
    </ConfirmAction>
  )
}

/** Archive / restore the whole product, with confirmation. */
export function ProductStatusButton({ productId, active }: { productId: string; active: boolean }) {
  return active ? (
    <ConfirmAction
      trigger={<Button variant="outline" />}
      title="Archive this product?"
      description="It will be hidden from the active list and from new invoices. Its prices stay as they are, invoices that already use it are unchanged, and you can restore it any time."
      confirmLabel="Archive product"
      successMessage="Product archived."
      destructive
      run={() => setProductActiveAction(productId, false)}
    >
      <Archive />
      Archive
    </ConfirmAction>
  ) : (
    <ConfirmAction
      trigger={<Button variant="outline" />}
      title="Restore this product?"
      description="It will be listed as active and available for new invoices again."
      confirmLabel="Restore product"
      successMessage="Product restored."
      run={() => setProductActiveAction(productId, true)}
    >
      <RotateCcw />
      Restore
    </ConfirmAction>
  )
}
