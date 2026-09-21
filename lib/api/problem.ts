import { isServiceError, type ServiceErrorCode } from '@/lib/services/errors'

/**
 * RFC 9457 `application/problem+json`.
 *
 * One error shape for the whole API. The alternative — each endpoint inventing
 * `{ error: "..." }` or `{ message: [...] }` — means every integrator writes a
 * different parser and gets it wrong for the endpoint they tested least.
 *
 *   {
 *     "type":     "https://invoice-ai.app/problems/invalid-state",
 *     "title":    "Invoice is not a draft",
 *     "status":   409,
 *     "detail":   "Invoice 7f3c… is already issued as INV/26-27/0042.",
 *     "instance": "req_01J9Z…",
 *     "code":     "invalid_state",
 *     "errors":   []
 *   }
 *
 * `code` is the stable machine-readable half and `detail` is the human half.
 * Integrators should branch on `code`, never on `detail` or on `title`.
 */

const PROBLEM_BASE = 'https://invoice-ai.app/problems'

export interface ProblemBody {
  type: string
  title: string
  status: number
  detail: string
  instance: string
  code: string
  errors?: { path: string; message: string }[]
}

const STATUS_BY_CODE: Record<ServiceErrorCode, number> = {
  validation: 422,
  // 404 for another owner's row too — a 403 would confirm it exists, which is
  // enough to enumerate ids by probing.
  not_found: 404,
  invalid_state: 409,
  conflict: 409,
  forbidden: 403,
  // 502, not 500: Resend or OpenAI failing is not our bug, and the distinction
  // tells an integrator whether retrying is worth anything.
  upstream_failed: 502,
}

const TITLE_BY_CODE: Record<ServiceErrorCode, string> = {
  validation: 'Validation failed',
  not_found: 'Not found',
  invalid_state: 'Invalid state for this operation',
  conflict: 'Conflict',
  forbidden: 'Insufficient scope',
  upstream_failed: 'Upstream service failed',
}

export function problem(
  init: {
    status: number
    code: string
    title: string
    detail: string
    instance: string
    errors?: { path: string; message: string }[]
  },
  headers: Record<string, string> = {},
): Response {
  const body: ProblemBody = {
    type: `${PROBLEM_BASE}/${init.code.replace(/_/g, '-')}`,
    title: init.title,
    status: init.status,
    detail: init.detail,
    instance: init.instance,
    code: init.code,
    ...(init.errors?.length ? { errors: init.errors } : {}),
  }

  return new Response(JSON.stringify(body), {
    status: init.status,
    headers: {
      'content-type': 'application/problem+json; charset=utf-8',
      'x-request-id': init.instance,
      ...headers,
    },
  })
}

/** Map anything thrown inside a handler to a response. */
export function problemFromError(cause: unknown, requestId: string): Response {
  if (isServiceError(cause)) {
    return problem(
      {
        status: STATUS_BY_CODE[cause.code],
        code: cause.code,
        title: TITLE_BY_CODE[cause.code],
        detail: cause.message,
        instance: requestId,
        errors: cause.details,
      },
      // A 403 from a missing scope should tell the caller how to authenticate
      // correctly, not just that they failed.
      cause.code === 'forbidden' ? { 'www-authenticate': 'Bearer' } : {},
    )
  }

  // Never surface an unexpected error's message: it can carry a connection
  // string or a row's contents. The request id is the handle for correlating it
  // with the server log, which does have the detail.
  console.error('[api] unhandled error on %s', requestId, cause)

  return problem({
    status: 500,
    code: 'internal_error',
    title: 'Internal server error',
    detail: 'Something went wrong on our side. Quote the instance id if you contact support.',
    instance: requestId,
  })
}

export function unauthorized(detail: string, requestId: string): Response {
  return problem(
    {
      status: 401,
      code: 'unauthorized',
      title: 'Unauthorized',
      detail,
      instance: requestId,
    },
    { 'www-authenticate': 'Bearer realm="invoice-ai"' },
  )
}

export function rateLimited(detail: string, requestId: string, retryAfterSeconds: number): Response {
  return problem(
    {
      status: 429,
      code: 'rate_limited',
      title: 'Too many requests',
      detail,
      instance: requestId,
    },
    { 'retry-after': String(retryAfterSeconds) },
  )
}

/**
 * 428 Precondition Required.
 *
 * The status exists for exactly this: the request is well-formed but we refuse
 * to perform it without a precondition — here, an Idempotency-Key on an
 * operation that spends an invoice number.
 */
export function idempotencyKeyRequired(requestId: string): Response {
  return problem({
    status: 428,
    code: 'idempotency_key_required',
    title: 'Idempotency-Key required',
    detail:
      'This operation assigns or spends an invoice number. Send an Idempotency-Key header so a retry cannot do it twice.',
    instance: requestId,
  })
}
