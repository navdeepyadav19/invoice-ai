import type { InvoiceStatus } from '@/lib/database.types'

/**
 * Overdue is derived, never stored.
 *
 * The alternative — a nightly job flipping `open` rows to `overdue` — means the
 * dashboard is wrong for up to a day, and it needs a scheduler that can silently
 * stop running. Computing it at display time is always right and has nothing to
 * operate.
 *
 * Paid stays paid. An invoice settled after its due date shows as Paid with no
 * memory of the lateness.
 */
export function deriveStatus(
  invoice: { status: InvoiceStatus; due_date: string | null },
  now: Date = new Date(),
): InvoiceStatus {
  if (invoice.status !== 'open') return invoice.status
  if (!invoice.due_date) return 'open'

  return isPastDue(invoice.due_date, now) ? 'overdue' : 'open'
}

/**
 * "Today" means the calendar date in UTC, not on whatever machine runs the
 * code. Vercel and CI run in UTC while developers sit anywhere, so a
 * server-local date flips overdue status at a different instant per machine.
 * UTC is the neutral definition (Stripe bills in UTC days too); per-business
 * timezones can refine this later.
 *
 * en-CA formats as YYYY-MM-DD, the same shape as a Postgres `date` column.
 */
const UTC_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function todayUtc(now: Date = new Date()): string {
  return UTC_DAY.format(now)
}

/**
 * An invoice due on the 20th is not overdue *during* the 20th — it becomes
 * overdue once the 21st starts in UTC. Comparing YYYY-MM-DD strings compares
 * whole dates, so the time of day never changes the answer.
 */
export function isPastDue(dueDate: string, now: Date = new Date()): boolean {
  return todayUtc(now) > dueDate.slice(0, 10)
}

/** Whole days past due, for wording like "12 days overdue". Zero if not late. */
export function daysOverdue(dueDate: string, now: Date = new Date()): number {
  if (!isPastDue(dueDate, now)) return 0

  const today = Date.parse(`${todayUtc(now)}T00:00:00Z`)
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`)
  return Math.round((today - due) / 86_400_000)
}
