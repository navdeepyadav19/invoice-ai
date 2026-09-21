import type { PriceRecurringInterval, PriceRow } from '@/lib/database.types'

/**
 * Display and input helpers for catalog prices — pure, safe on client and server.
 *
 * Prices are stored in MAJOR units (numeric(14,2): 2500.00 is ₹2,500), unlike
 * the REST wire format, so nothing here converts to minor units. What matters
 * is that each currency gets its own number of decimals: ¥5,000 has none,
 * so the formatter asks Intl for the currency's digits instead of forcing 2
 * (which is what lib/money.ts's invoice formatters do).
 */

/** How many decimals a currency uses: USD 2, JPY 0, BHD 3. */
export function currencyDecimals(currency: string): number {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).resolvedOptions()
      .maximumFractionDigits ?? 2
  } catch {
    return 2
  }
}

/**
 * A major-unit amount in its currency, e.g. `₹2,500.00`, `¥5,000`, `$30.00`.
 * `compact` drops a whole amount's trailing zeros (`₹2,500`) for summaries.
 */
export function formatAmount(
  amount: number | string,
  currency: string,
  { compact = false, locale = 'en-US' }: { compact?: boolean; locale?: string } = {},
): string {
  const value = Number(amount)
  try {
    const options: Intl.NumberFormatOptions & { trailingZeroDisplay?: 'auto' | 'stripIfInteger' } = {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
    }
    if (compact) options.trailingZeroDisplay = 'stripIfInteger'
    return new Intl.NumberFormat(locale, options).format(value)
  } catch {
    return `${currency} ${value.toFixed(currencyDecimals(currency))}`
  }
}

const SHORT_INTERVAL: Record<PriceRecurringInterval, string> = {
  day: 'day',
  week: 'wk',
  month: 'mo',
  year: 'yr',
}

type RecurringShape = Pick<PriceRow, 'type' | 'recurring_interval' | 'interval_count'>

/** `/mo`, `every 3 months`, or `` for one-off prices. */
export function formatInterval(price: RecurringShape, { short = true } = {}): string {
  if (price.type !== 'recurring' || !price.recurring_interval) return ''
  const count = Number(price.interval_count) || 1
  const interval = price.recurring_interval
  if (count === 1) return short ? `/${SHORT_INTERVAL[interval]}` : `per ${interval}`
  return `every ${count} ${interval}s`
}

/** Human description of the billing cadence: "One-off", "Monthly", "Every 3 months". */
export function describeBilling(price: RecurringShape): string {
  if (price.type !== 'recurring' || !price.recurring_interval) return 'One-off'
  const count = Number(price.interval_count) || 1
  if (count === 1) {
    return { day: 'Daily', week: 'Weekly', month: 'Monthly', year: 'Yearly' }[price.recurring_interval]
  }
  return `Every ${count} ${price.recurring_interval}s`
}

type LabelShape = RecurringShape & Pick<PriceRow, 'unit_amount' | 'currency'>

/** `₹2,500/mo`, `$30 every 3 months`, `¥5,000`. */
export function formatPriceLabel(price: LabelShape, { compact = true } = {}): string {
  const amount = formatAmount(price.unit_amount, price.currency, { compact })
  const interval = formatInterval(price)
  if (!interval) return amount
  return interval.startsWith('/') ? `${amount}${interval}` : `${amount} ${interval}`
}

/**
 * The list-page summary of a product's prices: `₹2,500/mo · $30/mo`, with
 * `+N more` past `max`. Callers pass active prices only.
 */
export function summarizePrices(prices: LabelShape[], max = 2): string {
  if (prices.length === 0) return ''
  const shown = prices.slice(0, max).map((p) => formatPriceLabel(p))
  const rest = prices.length - shown.length
  return rest > 0 ? `${shown.join(' · ')} · +${rest} more` : shown.join(' · ')
}

export type ParsedAmount = { ok: true; value: number } | { ok: false; message: string }

/**
 * Read a typed major-unit amount ("2,500.50") for a currency.
 *
 * Rejects more decimals than the currency has — "5000.5" JPY is not a price
 * anyone can pay — instead of silently rounding it.
 */
export function parseMajorAmount(raw: string, currency: string): ParsedAmount {
  const text = raw.trim().replace(/[,\s_]/g, '')
  if (!text) return { ok: false, message: 'Enter an amount' }
  if (!/^\d+(\.\d+)?$/.test(text)) return { ok: false, message: 'Enter a number, like 2500 or 49.99' }

  // Stored as numeric(14,2), so three-decimal currencies (BHD, KWD) stop at 2.
  const decimals = Math.min(currencyDecimals(currency), 2)
  const fraction = text.split('.')[1] ?? ''
  if (fraction.replace(/0+$/, '').length > decimals) {
    return {
      ok: false,
      message:
        decimals === 0
          ? `${currency} has no minor unit — use a whole amount`
          : `${currency} allows at most ${decimals} decimal places`,
    }
  }

  const value = Number(text)
  if (!Number.isFinite(value) || value > 999_999_999_999) return { ok: false, message: 'That amount is too large' }
  return { ok: true, value }
}
