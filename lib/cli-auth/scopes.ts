import { SCOPES, type Scope } from '@/lib/auth/scopes'

/**
 * Pre-ticked on the CLI consent screen. Everything except admin-grade scopes —
 * today there are none (credential management is deliberately never a scope,
 * see lib/auth/scopes.ts), so this is every scope; the filter keeps a future
 * `*:admin` from being granted to a laptop by default.
 *
 * Its own module (no node:crypto) because the client-side consent form needs it.
 */
export const CLI_DEFAULT_SCOPES: readonly Scope[] = SCOPES.filter(
  (scope) => !scope.endsWith(':admin'),
)
