/**
 * One error type for every business rule the service layer enforces.
 *
 * The point is that a service function has no idea who is calling it. The same
 * "this invoice is not a draft" has to become a friendly sentence in a form, a
 * 409 in problem+json, and something a language model can act on — so the
 * service throws a *code*, and each caller decides how to say it:
 *
 *   server action  →  { error: 'This invoice has already been sent.' }
 *   REST API       →  409 application/problem+json
 *   MCP            →  a sentence the model can recover from
 *
 * Codes, not messages, are the contract. Messages can be reworded freely;
 * changing a code changes an HTTP status somebody's integration branches on.
 */

export type ServiceErrorCode =
  /** Input failed schema validation. Carries `details`. */
  | 'validation'
  /** No such row — or it belongs to someone else. See the note below. */
  | 'not_found'
  /** The row exists but is in the wrong state (editing an issued invoice). */
  | 'invalid_state'
  /** A uniqueness or concurrency clash (a duplicate idempotency key). */
  | 'conflict'
  /** Authenticated, but this credential lacks the scope. */
  | 'forbidden'
  /** Something we depend on failed: Resend, OpenAI, or another provider. */
  | 'upstream_failed'

export interface ServiceErrorDetail {
  path: string
  message: string
}

export class ServiceError extends Error {
  readonly code: ServiceErrorCode
  readonly details?: ServiceErrorDetail[]

  constructor(code: ServiceErrorCode, message: string, details?: ServiceErrorDetail[]) {
    super(message)
    this.name = 'ServiceError'
    this.code = code
    this.details = details
  }
}

export function isServiceError(value: unknown): value is ServiceError {
  return value instanceof ServiceError
}

/**
 * Another owner's invoice id returns `not_found`, never `forbidden`.
 *
 * `forbidden` would confirm the row exists, which is enough to enumerate every
 * invoice id in the system by probing. RLS already returns an empty result for
 * rows we don't own, so this helper is mostly a reminder of which code to use.
 */
export function notFound(what = 'Not found'): ServiceError {
  return new ServiceError('not_found', what)
}

export function invalidState(message: string): ServiceError {
  return new ServiceError('invalid_state', message)
}

export function forbidden(message: string): ServiceError {
  return new ServiceError('forbidden', message)
}

export function upstreamFailed(message: string): ServiceError {
  return new ServiceError('upstream_failed', message)
}

/**
 * Postgres errors raised by our SECURITY DEFINER functions.
 *
 * issue_invoice() and replace_invoice_items() raise bare SQLSTATEs rather than
 * messages so the mapping lives here, in one place, instead of being string-
 * matched at every call site.
 */
export function fromPostgres(error: { code?: string; message?: string } | null): ServiceError {
  const message = error?.message ?? 'Database error'

  switch (error?.code) {
    case 'P0002':
      return notFound()
    case 'P0001':
      return invalidState(message)
    // 23505 unique_violation — e.g. two invoices claiming one number.
    case '23505':
      return new ServiceError('conflict', message)
    // 23514 check_violation — e.g. an invoice prefix over the length limit.
    case '23514':
      return new ServiceError('validation', message)
    default:
      return upstreamFailed(message)
  }
}
