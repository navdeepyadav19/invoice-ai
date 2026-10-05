import { createHmac } from 'node:crypto'

/**
 * One root secret, many purpose-specific keys.
 *
 * API_KEY_PEPPER is the only signing/hashing secret this app keeps. Rather than
 * reuse it directly for every job (hashing API keys, OAuth tokens, signing MCP
 * confirmations…), each job gets its own key derived from it with a label:
 *
 *   key = HMAC-SHA256(API_KEY_PEPPER, "invoice-ai/<label>")
 *
 * Two properties make this worth the one extra line:
 *   - Domain separation: a value hashed for one purpose can never be replayed
 *     as valid for another, because the keys differ.
 *   - One thing to rotate: changing the pepper rotates every derived key.
 *
 * Labels carry a version (`…/v1`) so a single purpose can be rotated alone.
 */
export function deriveKey(label: string): Buffer {
  const pepper = process.env.API_KEY_PEPPER
  if (!pepper) throw new Error('API_KEY_PEPPER is not set.')
  return createHmac('sha256', pepper).update(`invoice-ai/${label}`).digest()
}
