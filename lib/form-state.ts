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
  /**
   * The values that were submitted, echoed back so the form can restore them.
   *
   * React resets a form after its action runs, including on a failed
   * validation — uncontrolled inputs snap back to their `defaultValue` and the
   * user loses everything they typed. Feeding these values in as the
   * `defaultValue` means the reset restores their work instead of erasing it.
   */
  values?: Record<string, string>
  saved?: boolean
}

export interface AuthFormState {
  error?: string
  message?: string
}

/** Carries a guest's single-use merge token across a sign-in. */
export const PENDING_MERGE_COOKIE = 'pending_merge_uid'

/** Field names never echoed back into the DOM, however the form failed. */
const NEVER_ECHO = new Set(['password', 'confirm_password', 'gst_data'])

/** Collects the submitted text values so a failed form can be repopulated. */
export function echoValues(formData: FormData): Record<string, string> {
  const values: Record<string, string> = {}

  for (const [key, value] of formData.entries()) {
    if (typeof value !== 'string') continue
    if (NEVER_ECHO.has(key)) continue
    values[key] = value
  }

  return values
}

/**
 * Flattens a Zod error into one message per field, keeping the first per path,
 * and echoes the submission back so nothing typed is lost.
 */
export function toFieldErrors(error: ZodError, formData?: FormData): StepState {
  const fieldErrors: Record<string, string> = {}

  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
  }

  return {
    fieldErrors,
    error: 'Fix the highlighted fields and try again.',
    values: formData ? echoValues(formData) : undefined,
  }
}
