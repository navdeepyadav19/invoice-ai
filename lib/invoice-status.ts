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
 * An invoice due on the 20th is not overdue *during* the 20th — it becomes
 * overdue once the 21st starts. Comparing whole dates rather than timestamps is
 * what makes that true regardless of what time of day the page is loaded.
 */
export function isPastDue(dueDate: string, now: Date = new Date()): boolean {
  const today = toDateOnly(now)
  const due = new Date(`${dueDate}T00:00:00`)
  return today.getTime() > due.getTime()
}

function toDateOnly(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

/** Whole days past due, for wording like "12 days overdue". Zero if not late. */
export function daysOverdue(dueDate: string, now: Date = new Date()): number {
  if (!isPastDue(dueDate, now)) return 0

  const today = toDateOnly(now)
  const due = new Date(`${dueDate}T00:00:00`)
  return Math.round((today.getTime() - due.getTime()) / 86_400_000)
}
