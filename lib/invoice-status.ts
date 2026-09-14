import type { InvoiceStatus } from '@/lib/database.types'

/**
 * Overdue is derived, never stored.
 *
 * The alternative — a nightly job flipping `sent` rows to `overdue` — means the
 * dashboard is wrong for up to a day, and it needs a scheduler that can silently
 * stop running. Computing it at display time is always right and has nothing to
 * operate.
 *
 * The `overdue` enum value stays in the schema so an invoice can still be marked
 * overdue by hand later; nothing writes it today.
 *
 * Paid stays paid. An invoice settled after its due date shows as Paid with no
 * memory of the lateness.
 */
export function deriveStatus(
  invoice: { status: InvoiceStatus; due_date: string | null },
  now: Date = new Date(),
): InvoiceStatus {
  if (invoice.status !== 'sent') return invoice.status
  if (!invoice.due_date) return 'sent'

  return isPastDue(invoice.due_date, now) ? 'overdue' : 'sent'
}

/**
 * GST invoices are Indian documents, so "today" means the calendar date in
 * India, not on whatever machine runs the code. Vercel and CI run in UTC, which
 * is 5h30m behind: using the server's local date left yesterday's invoices
 * not-yet-overdue until 05:30 IST every morning.
 *
 * en-CA formats as YYYY-MM-DD, the same shape as a Postgres `date` column.
 */
const INDIA_DATE = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function todayInIndia(now: Date): string {
  return INDIA_DATE.format(now)
}

/**
 * An invoice due on the 20th is not overdue *during* the 20th — it becomes
 * overdue once the 21st starts in India. Comparing YYYY-MM-DD strings compares
 * whole dates, so the time of day never changes the answer.
 */
export function isPastDue(dueDate: string, now: Date = new Date()): boolean {
  return todayInIndia(now) > dueDate.slice(0, 10)
}

/** Whole days past due, for wording like "12 days overdue". Zero if not late. */
export function daysOverdue(dueDate: string, now: Date = new Date()): number {
  if (!isPastDue(dueDate, now)) return 0

  const today = Date.parse(`${todayInIndia(now)}T00:00:00Z`)
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00Z`)
  return Math.round((today - due) / 86_400_000)
}
