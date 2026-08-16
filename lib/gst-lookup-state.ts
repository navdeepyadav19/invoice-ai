import type { PrefilledBusiness } from '@/lib/sandbox/map'

/**
 * Shared between the lookup server action and the client form.
 *
 * Lives outside any 'use server' module because those may only export async
 * functions — a plain type or constant there silently voids the whole module.
 */

export type LookupOutcome =
  /** One GSTIN resolved; the form can be prefilled. */
  | { status: 'found'; business: PrefilledBusiness; warning?: string }
  /** A PAN matched several registrations; the user has to pick one. */
  | { status: 'choose'; candidates: PrefilledBusiness[] }
  /** Nothing found, or lookups are switched off. Fall through to manual entry. */
  | { status: 'manual'; message: string }
  /** The input was rejected before we called anything. */
  | { status: 'error'; message: string }

export const GST_LOOKUP_IDLE: LookupOutcome | null = null
