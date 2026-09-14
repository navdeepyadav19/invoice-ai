import type { ZodError } from 'zod'

/**
 * Shared form plumbing.
 *
 * This deliberately lives OUTSIDE any 'use server' module: those may only export
 * async functions, so a single exported constant or sync helper makes Next treat
 * the whole file as having no exports — and the error surfaces at the import
 * site, not at the offending line.
 */

export interface StepState {
  error?: string
  fieldErrors?: Record<string, string>
  saved?: boolean
}

export interface AuthFormState {
  error?: string
  message?: string
}

/** Carries a guest's single-use merge token across a sign-in. */
export const PENDING_MERGE_COOKIE = 'pending_merge_uid'

/** Flattens a Zod error into one message per field, keeping the first per path. */
export function toFieldErrors(error: ZodError): StepState {
  const fieldErrors: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }

  return { fieldErrors, error: 'Fix the highlighted fields and try again.' }
}
