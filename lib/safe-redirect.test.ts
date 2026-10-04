import { describe, expect, it } from 'vitest'

import { safeNextPath } from './safe-redirect'

describe('safeNextPath', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/cli/authorize?code=WXYZ-2345', '/cli/authorize?code=WXYZ-2345'],
    ['/invoices/abc/edit#lines', '/invoices/abc/edit#lines'],
  ])('keeps the same-origin path %s', (input, expected) => {
    expect(safeNextPath(input, '/fallback')).toBe(expected)
  })

  it.each([
    ['protocol-relative', '//evil.com'],
    ['backslash trick', '/\\evil.com'],
    ['double backslash', '/\\\\evil.com'],
    ['tab inside the slashes', '/\t/evil.com'],
    ['newline inside the slashes', '/\n/evil.com'],
    ['absolute URL', 'https://evil.com'],
    ['javascript URL', 'javascript:alert(1)'],
    ['relative path', 'dashboard'],
    ['empty', ''],
    ['not a string', null],
    ['an array', ['/dashboard']],
  ])('refuses %s', (_label, input) => {
    expect(safeNextPath(input, '/fallback')).toBe('/fallback')
  })

  it('never returns something a browser reads as another host', () => {
    for (const attempt of ['/%2F/evil.com', '/./\\evil.com', '/..//evil.com', '/%5Cevil.com']) {
      const out = safeNextPath(attempt, '/fallback')
      expect(new URL(out, 'https://invoice.horizonpay.co').host).toBe('invoice.horizonpay.co')
    }
  })
})
