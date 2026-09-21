import { ServiceError } from '@/lib/services/errors'

/**
 * Resolve invoice lines against the catalog — pure, no I/O.
 *
 * A line either names a price or is fully ad-hoc. Priced lines borrow
 * description/rate/tax_rate from the price unless the caller passed them
 * explicitly (presence, not value, decides — an explicit 0 is honored). The
 * price currency must match the invoice currency because this product does
 * no FX.
 */

export interface PricedLineInput {
  description: string
  quantity: number
  unit: string
  rate?: number
  discount_percent: number
  tax_rate?: number
  price?: string
}

export interface CatalogPrice {
  id: string
  public_id: string
  product_id: string
  product_name: string
  unit_amount: number
  currency: string
  tax_rate: number
}

export interface ResolvedLine {
  description: string
  quantity: number
  unit: string
  rate: number
  discountPercent: number
  taxRate: number
  productId: string | null
  priceId: string | null
}

export function resolvePricedLines(
  items: PricedLineInput[],
  invoiceCurrency: string,
  pricesByRef: Map<string, CatalogPrice>,
): ResolvedLine[] {
  return items.map((item, index) => {
    const at = (field: string) => `items.${index}.${field}`

    if (!item.price) {
      if (!item.description.trim()) {
        throw new ServiceError('validation', 'Some fields need attention.', [
          { path: at('description'), message: 'Describe what you are billing for' },
        ])
      }
      if (item.rate === undefined) {
        throw new ServiceError('validation', 'Some fields need attention.', [
          { path: at('rate'), message: 'Enter a rate' },
        ])
      }
      return {
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        rate: item.rate,
        discountPercent: item.discount_percent,
        taxRate: item.tax_rate ?? 0,
        productId: null,
        priceId: null,
      }
    }

    const price = pricesByRef.get(item.price)
    if (!price) {
      throw new ServiceError('validation', 'Some fields need attention.', [
        { path: at('price'), message: 'Unknown price.' },
      ])
    }

    if (price.currency.toUpperCase() !== invoiceCurrency.toUpperCase()) {
      throw new ServiceError('validation', 'Some fields need attention.', [
        {
          path: at('price'),
          message: `This price is in ${price.currency} but the invoice is in ${invoiceCurrency}.`,
        },
      ])
    }

    const description = item.description.trim() ? item.description : price.product_name
    const rate = item.rate ?? Number(price.unit_amount)
    const taxRate = item.tax_rate ?? Number(price.tax_rate)

    if (!description.trim()) {
      throw new ServiceError('validation', 'Some fields need attention.', [
        { path: at('description'), message: 'Describe what you are billing for' },
      ])
    }

    return {
      description,
      quantity: item.quantity,
      unit: item.unit,
      rate,
      discountPercent: item.discount_percent,
      taxRate,
      productId: price.product_id,
      priceId: price.id,
    }
  })
}
