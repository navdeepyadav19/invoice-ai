import { isScope, type Scope } from '@/lib/auth/scopes'

/**
 * Scopes as OAuth carries them: one space-separated string.
 *
 * Some scopes are useless alone. Drafting an invoice reads the business
 * profile (for the currency and the seller's details) and the customer it's
 * for; acting on an invoice first reads it to show the preview. Granting
 * `invoices:write` without those would produce a connection that fails on its
 * first call, so approving a scope also grants what it needs to work.
 *
 * Kept free of server-only imports: the consent form uses it in the browser.
 */

const DEPENDS_ON: Partial<Record<Scope, Scope[]>> = {
  'invoices:write': ['business:read', 'clients:read', 'invoices:read'],
  'invoices:finalize': ['invoices:read'],
  'invoices:send': ['invoices:read'],
  'payments:write': ['invoices:read'],
  'clients:write': ['clients:read'],
  'products:write': ['products:read'],
}

export function parseScopeParam(value: string | null | undefined): { scopes: Scope[]; unknown: string[] } {
  const scopes: Scope[] = []
  const unknown: string[] = []
  for (const part of (value ?? '').split(/\s+/).filter(Boolean)) {
    if (isScope(part)) {
      if (!scopes.includes(part)) scopes.push(part)
    } else {
      unknown.push(part)
    }
  }
  return { scopes, unknown }
}

export function expandScopeDependencies(scopes: readonly Scope[]): Scope[] {
  const out = new Set<Scope>(scopes)
  for (const scope of scopes) for (const needed of DEPENDS_ON[scope] ?? []) out.add(needed)
  return [...out]
}

/** The scopes a given scope pulls in, for the consent screen to explain. */
export function dependenciesOf(scope: Scope): readonly Scope[] {
  return DEPENDS_ON[scope] ?? []
}

export function formatScopeParam(scopes: readonly string[]): string {
  return [...scopes].sort().join(' ')
}
