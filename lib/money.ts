/**
 * All invoice arithmetic runs on integer paise, never floating-point rupees.
 *
 * The reason is concrete: 0.1 + 0.2 !== 0.3 in IEEE-754, and an invoice sums
 * dozens of tax amounts before being compared against a GSTR filing that must
 * reconcile to the paisa. Converting to integers at the boundary and back only
 * for display keeps every intermediate step exact.
 */

/** Rupees (possibly fractional) -> integer paise. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100)
}

/** Integer paise -> rupees, as a number with at most 2 decimals. */
export function toRupees(paise: number): number {
  return paise / 100
}

/**
 * Currency-neutral aliases. The engine works in integer minor units for any
 * currency (paise, cents); these names avoid implying INR everywhere.
 */
export const toMinor = toPaise
export const toMajor = toRupees

/**
 * Multiply an integer paise amount by a decimal factor (a quantity, or a
 * percentage already divided by 100) and round half-up to whole paise.
 *
 * Math.round is half-up for positives, which matches how a human accountant
 * rounds an invoice line. Negative amounts (credit lines) are rounded away from
 * zero for symmetry, so a -0.5 paise result doesn't drift toward zero.
 */
export function mulPaise(paise: number, factor: number): number {
  const raw = paise * factor
  return raw < 0 ? -Math.round(-raw) : Math.round(raw)
}

export const mulMinor = mulPaise

/** Round a paise amount to the nearest whole rupee (100 paise). */
export function roundToRupee(paise: number): number {
  return Math.round(paise / 100) * 100
}

/** Format minor units for display using the caller's locale. */
export function formatMinor(minor: number, currency = 'USD', locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(minor))
}

/** Format paise for display: 123456 -> "$1,234.56" (locale-aware). */
export function formatPaise(paise: number, currency = 'USD', locale?: string): string {
  return new Intl.NumberFormat(locale ?? 'en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(paise))
}

/** Same as formatPaise but without the currency symbol, for table columns. */
export function formatPaisePlain(paise: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(paise))
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
]

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return ones ? `${TENS[tens]} ${ONES[ones]}` : TENS[tens]
}

function threeDigits(n: number): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (hundreds) parts.push(`${ONES[hundreds]} Hundred`)
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

/**
 * Amount in words using the international numbering system
 * (thousand / million / billion). Generic for any currency.
 */
export function amountInWords(paise: number, currency = 'USD'): string {
  if (paise === 0) return `Zero ${currency} Only`

  const negative = paise < 0
  const abs = Math.abs(paise)
  const major = Math.floor(abs / 100)
  const fraction = abs % 100

  const segments: string[] = []
  const billion = Math.floor(major / 1_000_000_000)
  const million = Math.floor((major % 1_000_000_000) / 1_000_000)
  const thousand = Math.floor((major % 1_000_000) / 1_000)
  const rest = major % 1_000

  if (billion) segments.push(`${threeDigits(billion)} Billion`)
  if (million) segments.push(`${threeDigits(million)} Million`)
  if (thousand) segments.push(`${threeDigits(thousand)} Thousand`)
  if (rest) segments.push(threeDigits(rest))

  const majorUnit = currency
  const minorUnit = 'Cents'

  const words: string[] = []
  if (negative) words.push('Minus')
  words.push(segments.length ? segments.join(' ') : 'Zero', majorUnit)
  if (fraction) words.push('and', twoDigits(fraction), minorUnit)
  words.push('Only')

  return words.join(' ').replace(/\s+/g, ' ').trim()
}
