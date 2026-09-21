import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getCurrentUser } from '@/lib/queries'

export interface PickerAvailability {
  customers: boolean
  prices: boolean
}

/**
 * Should the builder offer the saved-customer and catalog pickers?
 *
 * Guests never see them: their data is deleted after 30 days and the saved
 * customer / catalog pages are account features, the same line the settings
 * pages draw. For everyone else a picker only appears when there is something
 * to pick — an empty dropdown on every new invoice is noise.
 *
 * Two HEAD counts under RLS; a failure just hides the picker.
 */
export async function pickerAvailability(): Promise<PickerAvailability> {
  const user = await getCurrentUser()
  if (!user || user.is_anonymous) return { customers: false, prices: false }

  const supabase = await createClient()
  const [clients, prices] = await Promise.all([
    supabase.from('clients').select('id', { count: 'exact', head: true }).is('archived_at', null),
    supabase.from('prices').select('id', { count: 'exact', head: true }).eq('active', true),
  ])

  return {
    customers: !clients.error && (clients.count ?? 0) > 0,
    prices: !prices.error && (prices.count ?? 0) > 0,
  }
}
