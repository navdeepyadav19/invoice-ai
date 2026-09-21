import { headers } from 'next/headers'

import { FALLBACK_COUNTRY_CODE, isCountryCode } from '@/lib/locale/countries'

/**
 * Country from the edge, never the raw IP.
 *
 * Vercel sets `x-vercel-ip-country`. Cloudflare sets `cf-ipcountry`. Local
 * `next dev` has neither, so we fall back to the United States.
 */
export function countryFromHeaders(headerList: Headers): string {
  const raw = (
    headerList.get('x-vercel-ip-country') ??
    headerList.get('cf-ipcountry') ??
    headerList.get('x-country-code') ??
    ''
  )
    .trim()
    .toUpperCase()

  if (raw && raw !== 'XX' && raw !== 'T1' && isCountryCode(raw)) return raw
  return FALLBACK_COUNTRY_CODE
}

export async function countryFromRequest(): Promise<string> {
  return countryFromHeaders(await headers())
}
