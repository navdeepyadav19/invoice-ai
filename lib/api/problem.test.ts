import { describe, expect, it } from 'vitest'

import { notFound, rateLimitedError, ServiceError } from '@/lib/services/errors'
import { problemFromError } from './problem'

describe('problemFromError', () => {
  it('turns a per-owner cap into a 429 with Retry-After', async () => {
    const response = problemFromError(rateLimitedError('Too many invoices emailed in the last hour.', 1200), 'req_1')

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('1200')
    expect(await response.json()).toMatchObject({ code: 'rate_limited', instance: 'req_1' })
  })

  it('asks for a bearer token on a missing scope', () => {
    const response = problemFromError(new ServiceError('forbidden', 'Needs invoices:send.'), 'req_2')

    expect(response.status).toBe(403)
    expect(response.headers.get('www-authenticate')).toBe('Bearer')
    expect(response.headers.get('retry-after')).toBeNull()
  })

  it('never leaks an unexpected error message', async () => {
    const response = problemFromError(new Error('connect ECONNREFUSED postgres://owner:pw@db'), 'req_3')
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).not.toContain('postgres://')
  })

  it('keeps 404 for rows the caller cannot see', () => {
    expect(problemFromError(notFound(), 'req_4').status).toBe(404)
  })
})
