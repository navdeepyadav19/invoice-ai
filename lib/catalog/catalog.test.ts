import { describe, expect, it } from 'vitest'

import { isPriceId, isProductId, nextPriceId, nextProductId } from './ids'
import { resolvePricedLines, type CatalogPrice } from './resolve'

function price(overrides: Partial<CatalogPrice> = {}): CatalogPrice {
  return {
    id: '00000000-0000-0000-0000-000000000001',
    public_id: 'price_AbC12345678901234567890',
    product_id: '00000000-0000-0000-0000-000000000002',
    product_name: 'Consulting retainer',
    unit_amount: 5000,
    currency: 'USD',
    tax_rate: 10,
    ...overrides,
  }
}

function catchServiceError(fn: () => unknown): { details?: Array<{ path: string; message: string }> } | null {
  try {
    fn()
  } catch (error) {
    return error as { details?: Array<{ path: string; message: string }> }
  }
  return null
}

function byRef(p: CatalogPrice): Map<string, CatalogPrice> {
  return new Map([
    [p.id, p],
    [p.public_id, p],
  ])
}

describe('catalog IDs', () => {
  it('mints prefixed, unguessable IDs', () => {
    const a = nextProductId()
    const b = nextProductId()

    expect(a).toMatch(/^prod_[A-Za-z0-9]{24}$/)
    expect(a).not.toBe(b)
    expect(isProductId(a)).toBe(true)
    expect(isProductId(nextPriceId())).toBe(false)
  })

  it('validates price IDs', () => {
    expect(isPriceId(nextPriceId())).toBe(true)
    expect(isPriceId('prod_abc')).toBe(false)
    expect(isPriceId('nope')).toBe(false)
  })
})

describe('resolvePricedLines', () => {
  it('borrows description, rate and tax from the price', () => {
    const p = price()
    const [resolved] = resolvePricedLines(
      [{ description: '', quantity: 2, unit: 'NOS', discount_percent: 0, price: p.public_id }],
      'USD',
      byRef(p),
    )

    expect(resolved).toMatchObject({
      description: 'Consulting retainer',
      quantity: 2,
      rate: 5000,
      taxRate: 10,
      productId: p.product_id,
      priceId: p.id,
    })
  })

  it('honors explicit overrides, including zero', () => {
    const p = price()
    const [resolved] = resolvePricedLines(
      [
        {
          description: 'Custom line',
          quantity: 1,
          unit: 'NOS',
          rate: 0,
          discount_percent: 0,
          tax_rate: 0,
          price: p.public_id,
        },
      ],
      'USD',
      byRef(p),
    )

    expect(resolved.description).toBe('Custom line')
    expect(resolved.rate).toBe(0)
    expect(resolved.taxRate).toBe(0)
  })

  it('passes ad-hoc lines through untouched', () => {
    const [resolved] = resolvePricedLines(
      [{ description: 'Design', quantity: 1, unit: 'HRS', rate: 200, discount_percent: 5, tax_rate: 20 }],
      'USD',
      new Map(),
    )

    expect(resolved).toMatchObject({
      description: 'Design',
      rate: 200,
      taxRate: 20,
      productId: null,
      priceId: null,
    })
  })

  it('rejects an unknown price with a field-scoped error', () => {
    const err = catchServiceError(() =>
      resolvePricedLines(
        [{ description: '', quantity: 1, unit: 'NOS', discount_percent: 0, price: 'price_nope' }],
        'USD',
        new Map(),
      ),
    )

    expect(err?.details).toEqual([{ path: 'items.0.price', message: 'Unknown price.' }])
  })

  it('rejects a price in another currency rather than converting silently', () => {
    const p = price({ currency: 'EUR' })

    const err = catchServiceError(() =>
      resolvePricedLines(
        [{ description: '', quantity: 1, unit: 'NOS', discount_percent: 0, price: p.public_id }],
        'USD',
        byRef(p),
      ),
    )

    expect(err?.details?.[0]?.path).toBe('items.0.price')
    expect(err?.details?.[0]?.message).toContain('EUR')
  })

  it('rejects an ad-hoc line with no description', () => {
    const err = catchServiceError(() =>
      resolvePricedLines(
        [{ description: '  ', quantity: 1, unit: 'NOS', rate: 10, discount_percent: 0 }],
        'USD',
        new Map(),
      ),
    )

    expect(err?.details).toEqual([
      { path: 'items.0.description', message: 'Describe what you are billing for' },
    ])
  })
})
