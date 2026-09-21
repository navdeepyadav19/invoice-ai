import { describe, expect, it } from 'vitest'

import { initialsFromEmail, isActivePath, isNavItemActive } from './nav'

describe('isActivePath', () => {
  it('matches the exact path and anything below it', () => {
    expect(isActivePath('/products', '/products')).toBe(true)
    expect(isActivePath('/products/abc', '/products')).toBe(true)
    expect(isActivePath('/products/abc/prices', '/products')).toBe(true)
  })

  it('does not match on a raw string prefix', () => {
    expect(isActivePath('/productsfoo', '/products')).toBe(false)
    expect(isActivePath('/settings', '/settings/business')).toBe(false)
  })

  it('tolerates a trailing slash on the prefix', () => {
    expect(isActivePath('/customers/1', '/customers/')).toBe(true)
  })

  it('treats the root as exact-only', () => {
    expect(isActivePath('/', '/')).toBe(true)
    expect(isActivePath('/dashboard', '/')).toBe(false)
  })
})

describe('isNavItemActive', () => {
  it('defaults to matching the href', () => {
    expect(isNavItemActive('/dashboard', { href: '/dashboard' })).toBe(true)
    expect(isNavItemActive('/invoices/new', { href: '/dashboard' })).toBe(false)
  })

  it('uses explicit match prefixes instead of the href when given', () => {
    const invoices = { href: '/dashboard', match: ['/invoices'] }
    expect(isNavItemActive('/invoices/abc/edit', invoices)).toBe(true)
    expect(isNavItemActive('/dashboard', invoices)).toBe(false)
  })

  it('is never active without a pathname', () => {
    expect(isNavItemActive(null, { href: '/dashboard' })).toBe(false)
  })
})

describe('initialsFromEmail', () => {
  it('takes up to two initials from the local part', () => {
    expect(initialsFromEmail('navdeep@example.com')).toBe('N')
    expect(initialsFromEmail('jane.doe@example.com')).toBe('JD')
    expect(initialsFromEmail('a_b+c@example.com')).toBe('AB')
  })

  it('falls back when there is no email', () => {
    expect(initialsFromEmail(null)).toBe('?')
    expect(initialsFromEmail('')).toBe('?')
  })
})
