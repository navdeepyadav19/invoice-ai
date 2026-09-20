/**
 * Public catalog IDs: `prod_…` and `price_…`, Stripe-style.
 *
 * UUIDs stay the primary keys; these are the API-facing identifiers. They are
 * random (unlike sequential numbers) so they can't be enumerated, and prefixed
 * so a price ID pasted where a product ID belongs fails loudly.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function randomSuffix(length = 24): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export function nextProductId(): string {
  return `prod_${randomSuffix()}`
}

export function nextPriceId(): string {
  return `price_${randomSuffix()}`
}

export function isProductId(value: string): boolean {
  return /^prod_[A-Za-z0-9]{16,32}$/.test(value)
}

export function isPriceId(value: string): boolean {
  return /^price_[A-Za-z0-9]{16,32}$/.test(value)
}

export function nextCustomerId(): string {
  return `cus_${randomSuffix()}`
}

export function nextInvoiceId(): string {
  return `in_${randomSuffix()}`
}

export function nextInvoiceItemId(): string {
  return `ii_${randomSuffix()}`
}

export function isCustomerId(value: string): boolean {
  return /^cus_[A-Za-z0-9]{24}$/.test(value)
}

export function isInvoiceId(value: string): boolean {
  return /^in_[A-Za-z0-9]{24}$/.test(value)
}

export function isInvoiceItemId(value: string): boolean {
  return /^ii_[A-Za-z0-9]{24}$/.test(value)
}
