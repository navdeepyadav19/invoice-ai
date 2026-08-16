'use server'

import { isSandboxConfigured, searchGstin, searchGstinsByPan } from '@/lib/sandbox/client'
import { isInactive, toPrefilledBusiness } from '@/lib/sandbox/map'
import { GSTIN_REGEX, PAN_REGEX, hasValidGstinChecksum } from '@/lib/validators'
import { requireUser } from '@/lib/queries'
import { isValidStateCode, stateName } from '@/lib/india'
import type { LookupOutcome } from '@/lib/gst-lookup-state'

/**
 * Look up a GSTIN and return prefill data.
 *
 * Validation happens locally first — format, then checksum — so a typo costs
 * nothing and never burns an API call against a paid quota.
 */
export async function lookupGstinAction(rawGstin: string): Promise<LookupOutcome> {
  await requireUser()

  const gstin = rawGstin.trim().toUpperCase()

  if (!GSTIN_REGEX.test(gstin)) {
    return { status: 'error', message: 'A GSTIN is 15 characters, like 27AAPFU0939F1ZV.' }
  }

  if (!hasValidGstinChecksum(gstin)) {
    return { status: 'error', message: 'That GSTIN fails its checksum — check for a typo.' }
  }

  if (!isSandboxConfigured()) {
    return {
      status: 'manual',
      message: 'GST lookup is not configured yet, so you can fill these in yourself.',
    }
  }

  const result = await searchGstin(gstin)

  if (!result.ok) {
    // Every failure lands the user in the manual form rather than a dead end.
    // A GST outage must never be the reason someone can't raise an invoice.
    return { status: 'manual', message: manualMessage(result.reason, result.message) }
  }

  const business = toPrefilledBusiness(result.data)

  return {
    status: 'found',
    business,
    warning: isInactive(business)
      ? `This GSTIN is marked "${business.gst_status ?? 'not active'}" on the GST portal. You can still continue, but check it before issuing tax invoices.`
      : undefined,
  }
}

/**
 * Look up the GSTINs registered against a PAN in one state.
 *
 * The state is not optional: registration is per-state, so "the GSTINs for this
 * PAN" only has an answer within a state. Most PANs return exactly one, but a
 * business registered in several states legitimately returns more, hence the
 * 'choose' outcome.
 */
export async function lookupPanAction(rawPan: string, stateCode: string): Promise<LookupOutcome> {
  await requireUser()

  const pan = rawPan.trim().toUpperCase()

  if (!PAN_REGEX.test(pan)) {
    return { status: 'error', message: 'A PAN is 10 characters, like AAPFU0939F.' }
  }

  if (!isValidStateCode(stateCode)) {
    return { status: 'error', message: 'Pick the state your business is registered in.' }
  }

  if (!isSandboxConfigured()) {
    return {
      status: 'manual',
      message: 'GST lookup is not configured yet, so you can fill these in yourself.',
    }
  }

  const result = await searchGstinsByPan(pan, stateCode)

  if (!result.ok) {
    if (result.reason === 'not_found') {
      return {
        status: 'manual',
        message: `No GST registration found for that PAN in ${stateName(stateCode) || 'that state'}. If you're not GST registered, that's expected — just fill in your details below.`,
      }
    }
    return { status: 'manual', message: manualMessage(result.reason, result.message) }
  }

  const candidates = result.data.map(toPrefilledBusiness)

  if (candidates.length === 1) {
    const business = candidates[0]
    return {
      status: 'found',
      business,
      warning: isInactive(business)
        ? `This GSTIN is marked "${business.gst_status ?? 'not active'}" on the GST portal.`
        : undefined,
    }
  }

  return { status: 'choose', candidates }
}

/** Confirms which of several PAN matches the user picked. */
export async function selectCandidateAction(gstin: string): Promise<LookupOutcome> {
  return lookupGstinAction(gstin)
}

// NOTE: no sync exports here. A 'use server' module may only export async
// functions; adding a re-export or a constant voids every export in the file.

function manualMessage(reason: string, detail: string): string {
  if (reason === 'not_found') {
    return `${detail} You can fill in your details below instead.`
  }
  if (reason === 'invalid') {
    return `${detail} Fill in your details below instead.`
  }
  return `We couldn't reach the GST service (${detail}). Fill in your details below and carry on.`
}

/** Used by the form to decide whether to offer lookup at all. */
export async function gstLookupAvailable(): Promise<boolean> {
  return isSandboxConfigured()
}

