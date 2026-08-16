import { siteUrl } from '@/lib/supabase/env'

/**
 * The public link a client opens. Lives here rather than in a 'use server'
 * module, which may only export async functions.
 */
export function publicInvoiceUrl(token: string): string {
  return `${siteUrl()}/i/${token}`
}

export function publicInvoicePdfUrl(token: string, download = false): string {
  return `${siteUrl()}/api/public/${token}/pdf${download ? '?download=1' : ''}`
}
