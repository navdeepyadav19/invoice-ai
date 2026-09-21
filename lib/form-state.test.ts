import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import {
  echoValues,
  isSensitiveField,
  keptValues,
  toFieldErrors,
  withValues,
} from './form-state'

function form(entries: [string, string | Blob][]): FormData {
  const data = new FormData()
  for (const [key, value] of entries) data.append(key, value)
  return data
}

describe('echoValues', () => {
  it('echoes plain text fields, including ones left empty', () => {
    const values = echoValues(
      form([
        ['legal_name', 'Umbrella Studio'],
        ['trade_name', ''],
      ]),
    )

    expect(values).toEqual({ legal_name: 'Umbrella Studio', trade_name: '' })
  })

  it('never echoes passwords or other credentials', () => {
    const values = echoValues(
      form([
        ['email', 'a@b.co'],
        ['password', 'hunter22'],
        ['confirm_password', 'hunter22'],
        ['new_password', 'x'],
        ['api_key', 'sk_live_123'],
        ['webhook_secret', 's'],
        ['otp', '123456'],
      ]),
    )

    expect(values).toEqual({ email: 'a@b.co' })
  })

  it('drops Next.js action plumbing and file uploads', () => {
    const values = echoValues(
      form([
        ['$ACTION_ID_abc123', ''],
        ['logo', new Blob(['png'])],
        ['city', 'Austin'],
      ]),
    )

    expect(values).toEqual({ city: 'Austin' })
  })

  it('leaves out extra fields passed in omit', () => {
    const values = echoValues(form([['city', 'Austin'], ['gstin_raw', '{}']]), {
      omit: ['gstin_raw'],
    })

    expect(values).toEqual({ city: 'Austin' })
  })

  it('collects a repeated name into an array, in order', () => {
    const values = echoValues(
      form([
        ['scopes', 'invoices:read'],
        ['scopes', 'clients:read'],
        ['scopes', 'business:read'],
      ]),
    )

    expect(values).toEqual({ scopes: ['invoices:read', 'clients:read', 'business:read'] })
  })
})

describe('isSensitiveField', () => {
  it.each(['password', 'confirm_password', 'current_password', 'secret', 'access_token', 'apiKey'])(
    'treats %s as sensitive',
    (name) => expect(isSensitiveField(name)).toBe(true),
  )

  it.each(['email', 'account_number', 'notes', 'routing_number', 'passport_country'])(
    'lets %s through',
    (name) => expect(isSensitiveField(name)).toBe(false),
  )
})

describe('withValues', () => {
  it('keeps the original state and adds the echoed submission', () => {
    const state = withValues(
      { error: 'Could not save.' },
      form([
        ['city', 'Austin'],
        ['password', 'nope'],
      ]),
    )

    expect(state).toEqual({ error: 'Could not save.', values: { city: 'Austin' } })
  })
})

describe('toFieldErrors', () => {
  it('echoes the submission alongside the field errors', () => {
    const schema = z.object({ city: z.string().min(2, 'Too short') })
    const data = form([['city', 'A']])
    const parsed = schema.safeParse({ city: 'A' })
    if (parsed.success) throw new Error('expected a validation failure')

    expect(toFieldErrors(parsed.error, data)).toEqual({
      error: 'Fix the highlighted fields and try again.',
      fieldErrors: { city: 'Too short' },
      values: { city: 'A' },
    })
  })
})

describe('keptValues', () => {
  it('falls back to the saved record before anything has been submitted', () => {
    const kept = keptValues(undefined)

    expect(kept.submitted).toBe(false)
    expect(kept.text('legal_name', 'Saved Name')).toBe('Saved Name')
    expect(kept.text('region', null)).toBe('')
    expect(kept.text('expires_in_days', 0)).toBe('0')
    expect(kept.list('scopes', ['invoices:read'])).toEqual(['invoices:read'])
    expect(kept.checked('events', 'invoice.paid', true)).toBe(true)
  })

  it('prefers what was submitted, even an emptied field', () => {
    const kept = keptValues({ legal_name: 'Typed Name', trade_name: '' })

    expect(kept.submitted).toBe(true)
    expect(kept.text('legal_name', 'Saved Name')).toBe('Typed Name')
    expect(kept.text('trade_name', 'Saved Trade')).toBe('')
  })

  it('falls back for a field the submission did not include', () => {
    expect(keptValues({ city: 'Austin' }).text('region', 'TX')).toBe('TX')
  })

  it('reads checkbox groups whether one or many boxes were ticked', () => {
    const one = keptValues({ events: 'invoice.paid' })
    const many = keptValues({ events: ['invoice.paid', 'invoice.sent'] })

    expect(one.list('events')).toEqual(['invoice.paid'])
    expect(many.checked('events', 'invoice.sent')).toBe(true)
    expect(many.checked('events', 'invoice.voided')).toBe(false)
  })

  it('treats an unticked group as empty after a submission, not as the fallback', () => {
    const kept = keptValues({ url: 'https://example.com' })

    expect(kept.list('events', ['invoice.paid'])).toEqual([])
    expect(kept.checked('events', 'invoice.paid', true)).toBe(false)
  })
})
