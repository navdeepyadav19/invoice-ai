import { describe, expect, it, vi } from 'vitest'

import { ServiceError, type ServiceErrorCode } from '@/lib/services/errors'

import { toolErrorFromCause } from './errors'

const text = (result: ReturnType<typeof toolErrorFromCause>) => (result.content[0] as { text: string }).text

describe('toolErrorFromCause', () => {
  const cases: Array<[ServiceErrorCode, RegExp]> = [
    ['validation', /Invalid input\..*Fix the arguments/],
    ['not_found', /search_customers or list_invoices/],
    ['invalid_state', /Don't retry the same call/],
    ['forbidden', /reconnect Invoice-AI.*settings\/ai-assistants.*Don't retry/],
    ['rate_limited', /Wait/],
    ['conflict', /already running/],
    ['idempotency_mismatch', /already done with different details/],
    ['upstream_failed', /retry once/],
  ]

  it.each(cases)('turns %s into an actionable sentence', (code, pattern) => {
    const result = toolErrorFromCause(new ServiceError(code, 'Service message.'), 'req_1')

    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(pattern)
  })

  it('lists validation details by field', () => {
    const result = toolErrorFromCause(
      new ServiceError('validation', 'Bad.', [{ path: 'items.0.unit_amount', message: 'Use whole minor units' }]),
      'req_1',
    )
    expect(text(result)).toContain('items.0.unit_amount: Use whole minor units')
  })

  it('says how long to wait when the limit says so', () => {
    const error = new ServiceError('rate_limited', 'Too many.')
    error.retryAfter = 42
    expect(text(toolErrorFromCause(error, 'req_1'))).toContain('42 seconds')
  })

  it('never shows the message of an unexpected error', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = toolErrorFromCause(new Error('connect ECONNREFUSED postgres://owner:secret@db'), 'req_9')

    expect(text(result)).not.toContain('postgres')
    expect(text(result)).toContain('req_9')
    log.mockRestore()
  })
})
