import { createHmac } from 'node:crypto'

import { randomString } from '@/lib/auth/api-key'
import { deriveKey } from '@/lib/auth/derive-key'

/**
 * Every secret the authorization server hands out.
 *
 *   inv_oat_…  access token     1 hour, sent on every request
 *   inv_ort_…  refresh token    30 days, swapped for a new pair (rotated) on use
 *   inv_oac_…  authorization code   5 minutes, once
 *   inv_ocs_…  client secret    for apps that registered as confidential
 *   oc_…       client id        public; not a secret
 *
 * The prefixes make a leaked token recognisable — to secret scanners, and to
 * authenticate(), which routes on them.
 *
 * Only a hash is ever stored: HMAC-SHA256 under a key derived for this purpose
 * (lib/auth/derive-key.ts). A copy of the database is not a pile of working
 * tokens, and lookup is a plain index hit on the hash.
 */

export const generateAccessToken = () => `inv_oat_${randomString(40)}`
export const generateRefreshToken = () => `inv_ort_${randomString(48)}`
export const generateAuthorizationCode = () => `inv_oac_${randomString(40)}`
export const generateClientSecret = () => `inv_ocs_${randomString(40)}`
export const generateClientId = () => `oc_${randomString(24)}`

/** Lowercase hex, which is the shape the database checks for. */
export function hashOAuthSecret(value: string): string {
  return createHmac('sha256', deriveKey('oauth-token/v1')).update(value).digest('hex')
}
