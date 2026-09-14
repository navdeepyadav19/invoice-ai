import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { siteUrl, supabasePublishableKey, supabaseUrl } from './supabase/env'
import { publicInvoicePdfUrl, publicInvoiceUrl } from './urls'

// Every test starts from a clean slate, so a developer's own shell or a CI
// runner's environment can't change the outcome.
beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', undefined)
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', undefined)
  vi.stubEnv('VERCEL_URL', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', undefined)
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('siteUrl', () => {
  it('falls back to localhost for local development', () => {
    expect(siteUrl()).toBe('http://localhost:3000')
  })

  it('prefers an explicit site URL and strips its trailing slash', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://invoices.example.com/')
    vi.stubEnv('VERCEL_URL', 'invoice-ai-git-feature.vercel.app')
    expect(siteUrl()).toBe('https://invoices.example.com')
  })

  it('uses the Vercel production URL over the per-deployment URL', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'invoice-ai.vercel.app')
    vi.stubEnv('VERCEL_URL', 'invoice-ai-abc123.vercel.app')
    expect(siteUrl()).toBe('https://invoice-ai.vercel.app')
  })

  it('uses the per-deployment URL on a preview with nothing else set', () => {
    vi.stubEnv('VERCEL_URL', 'invoice-ai-abc123.vercel.app')
    expect(siteUrl()).toBe('https://invoice-ai-abc123.vercel.app')
  })
})

describe('public invoice links', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://invoices.example.com')
  })

  it('builds the shareable page link', () => {
    expect(publicInvoiceUrl('tok_123')).toBe('https://invoices.example.com/i/tok_123')
  })

  it('builds the inline PDF link', () => {
    expect(publicInvoicePdfUrl('tok_123')).toBe('https://invoices.example.com/api/public/tok_123/pdf')
  })

  it('adds the download flag only when asked', () => {
    expect(publicInvoicePdfUrl('tok_123', true)).toBe(
      'https://invoices.example.com/api/public/tok_123/pdf?download=1',
    )
  })
})

describe('Supabase env', () => {
  it('fails loudly, naming the missing variable', () => {
    expect(() => supabaseUrl()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/)
    expect(() => supabasePublishableKey()).toThrow(/PUBLISHABLE_KEY/)
  })

  it('accepts the legacy anon key when there is no publishable key', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    expect(supabasePublishableKey()).toBe('anon-key')
  })

  it('prefers the publishable key when both exist', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'publishable-key')
    expect(supabasePublishableKey()).toBe('publishable-key')
  })
})
