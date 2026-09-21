import type { z } from 'zod'

import { ServiceError } from '@/lib/services/errors'

/**
 * Validate a Stripe-shaped wire payload against a zod schema.
 *
 * The services validate the internal shape again on the way in, so this is
 * the outer skin: it turns a wire mistake into a field-scoped 422 before any
 * business logic runs.
 */
export function parseWire<S extends z.ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ServiceError(
      'validation',
      'Some fields need attention.',
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    )
  }
  return parsed.data
}
