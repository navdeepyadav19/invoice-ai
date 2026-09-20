/**
 * What a credential is allowed to do.
 *
 * Scopes exist because "this key is valid" and "this key may issue an
 * invoice" are different questions. A Zapier integration that only needs to read
 * invoices should not hold a credential that can email your clients.
 *
 * Two rules that shape the list below:
 *
 *  1. **Issuing is separate from writing.** Editing a draft is reversible;
 *     assigning an invoice number is not. `invoices:write` cannot issue.
 *  2. **Credential management is never a scope.** Creating and revoking API keys
 *     happens only in the web UI, so a leaked key cannot mint more keys or hide
 *     its own tracks.
 */

export const SCOPES = [
  'business:read',
  'clients:read',
  'clients:write',
  'products:read',
  'products:write',
  'invoices:read',
  /** Create, update and delete DRAFTS only. */
  'invoices:write',
  /** Assign an invoice number, and cancel. One-way, legally meaningful. */
  'invoices:issue',
  /** Email an invoice to a client. Costs money and is visible to third parties. */
  'invoices:send',
  'payments:write',
  'webhooks:manage',
] as const

export type Scope = (typeof SCOPES)[number]

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPES)

export function isScope(value: string): value is Scope {
  return SCOPE_SET.has(value)
}

/** Drops anything unrecognised — a stored scope list can outlive a rename. */
export function parseScopes(values: readonly string[]): Scope[] {
  return values.filter(isScope)
}

/**
 * A browser session gets everything.
 *
 * The user is sitting there in person; there is no third party to limit. Scopes
 * only narrow *delegated* access, which is what keys and OAuth grants are.
 */
export const ALL_SCOPES: ReadonlySet<Scope> = new Set(SCOPES)

export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  'business:read': 'Read your business profile, tax ID and bank details',
  'clients:read': 'List and read your clients',
  'clients:write': 'Create, update and archive clients',
  'products:read': 'List and read products and prices',
  'products:write': 'Create, update and archive products and prices',
  'invoices:read': 'List and read invoices, including PDFs',
  'invoices:write': 'Create, edit and delete drafts',
  'invoices:issue': 'Assign an invoice number, and cancel invoices',
  'invoices:send': 'Email invoices to your clients',
  'payments:write': 'Mark invoices as paid',
  'webhooks:manage': 'Manage webhook endpoints',
}
