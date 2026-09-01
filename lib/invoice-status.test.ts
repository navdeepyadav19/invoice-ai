import { describe, expect, it } from 'vitest'

import { daysOverdue, deriveStatus, isPastDue } from './invoice-status'

const AUG_16 = new Date('2026-08-16T11:30:00+05:30')

describe('deriveStatus', () => {
  it('marks a sent invoice overdue once its due date has passed', () => {
    expect(deriveStatus({ status: 'sent', due_date: '2026-08-01' }, AUG_16)).toBe('overdue')
  })

  it('is not overdue on the due date itself', () => {
    expect(deriveStatus({ status: 'sent', due_date: '2026-08-16' }, AUG_16)).toBe('sent')
  })

  it('is not overdue before the due date', () => {
    expect(deriveStatus({ status: 'sent', due_date: '2026-08-31' }, AUG_16)).toBe('sent')
  })

  it('leaves a sent invoice with no due date alone', () => {
    expect(deriveStatus({ status: 'sent', due_date: null }, AUG_16)).toBe('sent')
  })

  it('keeps a paid invoice paid, however late it was settled', () => {
    expect(deriveStatus({ status: 'paid', due_date: '2020-01-01' }, AUG_16)).toBe('paid')
  })

  it('never promotes a draft', () => {
    expect(deriveStatus({ status: 'draft', due_date: '2020-01-01' }, AUG_16)).toBe('draft')
  })

  it('never resurrects a cancelled invoice', () => {
    expect(deriveStatus({ status: 'cancelled', due_date: '2020-01-01' }, AUG_16)).toBe('cancelled')
  })
})

describe('isPastDue', () => {
  it('compares whole dates, so the time of day never changes the answer', () => {
    const earlyMorning = new Date('2026-08-16T00:05:00+05:30')
    const lateNight = new Date('2026-08-16T23:55:00+05:30')

    expect(isPastDue('2026-08-16', earlyMorning)).toBe(false)
    expect(isPastDue('2026-08-16', lateNight)).toBe(false)
    expect(isPastDue('2026-08-15', earlyMorning)).toBe(true)
  })
})

describe('daysOverdue', () => {
  it('counts whole days late', () => {
    expect(daysOverdue('2026-08-01', AUG_16)).toBe(15)
  })

  it('is zero when not late', () => {
    expect(daysOverdue('2026-08-16', AUG_16)).toBe(0)
    expect(daysOverdue('2026-12-01', AUG_16)).toBe(0)
  })
})
