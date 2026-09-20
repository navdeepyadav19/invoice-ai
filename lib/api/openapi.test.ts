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
      '/clients',
      '/clients/{id}',
      '/clients/{id}/archive',
      '/invoices',
      '/invoices/{id}',
      '/invoices/{id}/cancel',
      '/invoices/{id}/events',
      '/invoices/{id}/issue',
      '/invoices/{id}/mark-paid',
      '/invoices/{id}/pdf',
      '/invoices/{id}/send',
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
      '/invoices/{id}/issue',
      '/invoices/{id}/send',
      '/invoices/{id}/mark-paid',
      '/invoices/{id}/cancel',
    ]) {
      const post = (document.paths?.[path] as Record<string, { responses?: object }>)?.post
      expect(Object.keys(post?.responses ?? {}), path).toContain('428')
    }
  })

  it('never puts a decimal amount on the wire', () => {
    const invoice = document.components?.schemas?.Invoice as
      | { properties?: Record<string, unknown> }
      | undefined

    const moneyish = Object.keys(invoice?.properties ?? {}).filter((key) =>
      /subtotal|total|discount|tax|round_off|rate/.test(key),
    )

    expect(moneyish.length).toBeGreaterThan(0)
    for (const key of moneyish) {
      // tax_rate and discount_percent are percentages, not money.
      if (key === 'tax_rate' || key === 'discount_percent') continue
      expect(key, `${key} should be an integer minor-units field`).toMatch(/_paise$/)
    }
  })

  it('describes errors as problem+json', () => {
    const get = (document.paths?.['/invoices'] as Record<string, { responses?: Record<string, { content?: object }> }>)
      ?.get

    expect(get?.responses?.['401']?.content).toHaveProperty('application/problem+json')
  })
})
