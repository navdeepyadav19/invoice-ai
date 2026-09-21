import { describe, expect, it } from 'vitest'

import { buildOpenApiDocument } from './openapi'

/**
 * The spec is generated from the same zod schemas that validate requests, so
 * these tests are really about one thing: the generator runs at all. A throw in
 * createDocument would otherwise only surface when somebody hit the endpoint.
 */
const document = buildOpenApiDocument('https://example.test/api/v1')

describe('OpenAPI document', () => {
  it('builds a 3.1 document', () => {
    expect(document.openapi).toBe('3.1.0')
    expect(document.info.title).toBe('Invoice-AI API')
  })

  it('documents every endpoint the router actually serves', () => {
    // If a route is added under app/api/v1 without being listed here, an SDK
    // generated from this spec silently cannot call it.
    expect(Object.keys(document.paths ?? {}).sort()).toEqual([
      '/business',
      '/customers',
      '/customers/{id}',
      '/invoice-items',
      '/invoice-items/{id}',
      '/invoices',
      '/invoices/{id}',
      '/invoices/{id}/events',
      '/invoices/{id}/finalize',
      '/invoices/{id}/pay',
      '/invoices/{id}/pdf',
      '/invoices/{id}/send',
      '/invoices/{id}/void',
      '/prices',
      '/prices/{id}',
      '/products',
      '/products/{id}',
      '/webhook-endpoints',
      '/webhook-endpoints/{id}',
    ])
  })

  it('requires bearer auth by default', () => {
    expect(document.security).toEqual([{ apiKey: [] }])
    expect(document.components?.securitySchemes?.apiKey).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    })
  })

  it('declares 428 on every endpoint that spends an invoice number', () => {
    // These are the operations where a retry has a real cost. Losing the 428
    // from the contract would tell integrators the key is optional.
    for (const path of [
      '/invoices',
      '/invoices/{id}/finalize',
      '/invoices/{id}/send',
      '/invoices/{id}/pay',
      '/invoices/{id}/void',
      '/invoice-items',
    ]) {
      const post = (document.paths?.[path] as Record<string, { responses?: object }>)?.post
      expect(Object.keys(post?.responses ?? {}), path).toContain('428')
    }
  })

  it('uses Stripe-style money fields as integers, never decimals', () => {
    const invoice = document.components?.schemas?.Invoice as
      | { properties?: Record<string, { type?: string; format?: string }> }
      | undefined

    // Stripe names: subtotal, discount, taxable, tax, total, amount_due.
    for (const key of ['subtotal', 'discount', 'taxable', 'tax', 'total', 'amount_due']) {
      const prop = invoice?.properties?.[key]
      expect(prop, `${key} should be documented`).toBeDefined()
      expect(prop?.type, `${key} should be an integer`).toBe('integer')
    }

    const price = document.components?.schemas?.Price as
      | { properties?: Record<string, { type?: string }> }
      | undefined
    expect(price?.properties?.unit_amount?.type).toBe('integer')

    const item = document.components?.schemas?.InvoiceItem as
      | { properties?: Record<string, { type?: string }> }
      | undefined
    expect(item?.properties?.unit_amount?.type).toBe('integer')
    expect(item?.properties?.amount?.type).toBe('integer')
  })

  it('describes errors as problem+json', () => {
    const get = (document.paths?.['/invoices'] as Record<string, { responses?: Record<string, { content?: object }> }>)
      ?.get

    expect(get?.responses?.['401']?.content).toHaveProperty('application/problem+json')
  })
})
