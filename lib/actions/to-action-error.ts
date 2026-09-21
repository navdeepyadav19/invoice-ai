import { isServiceError } from '@/lib/services/errors'

/**
 * Turn a ServiceError into what the existing UI already expects.
 *
 * This is the whole job of a server action now: translate. The service layer
 * throws a typed code, the REST API turns that into problem+json, and this turns
 * it into the `{ error }` / `{ fieldErrors }` shapes the forms have always used
 * (SendState in lib/send-state.ts, StepState in lib/form-state.ts).
 *
 * Nothing in components/ changes as a result of the refactor, which is the
 * property that makes it safe to do at all.
 */

export interface ActionError {
  error: string
  fieldErrors?: Record<string, string>
}

export function toActionError(cause: unknown): ActionError {
  if (isServiceError(cause)) {
    if (cause.code === 'validation' && cause.details?.length) {
      const fieldErrors: Record<string, string> = {}
      for (const detail of cause.details) {
        // First message per field wins — the form shows one line per input.
        if (!fieldErrors[detail.path]) fieldErrors[detail.path] = detail.message
      }
      return { error: cause.message, fieldErrors }
    }

    return { error: cause.message }
  }

  // An unexpected throw is a bug, not a business rule. Don't leak the internals
  // into the UI, but make sure it reaches the logs.
  console.error('[action] unexpected error', cause)
  return { error: 'Something went wrong. Please try again.' }
}
