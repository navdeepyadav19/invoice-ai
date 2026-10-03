import 'server-only'

import { userDb } from '@/lib/db'
import { getCurrentUser } from '@/lib/queries'

export interface PickerAvailability {
  customers: boolean
  prices: boolean
}

/**
 * Should the builder offer the saved-customer and catalog pickers?
 *
 * A picker only appears when there is something to pick — an empty dropdown
 * on every new invoice is noise.
 *
 * Two counts, run as the signed-in user (RLS scopes them); a failure just
 * hides the picker.
 */
export async function pickerAvailability(): Promise<PickerAvailability> {
  const user = await getCurrentUser()
  if (!user) return { customers: false, prices: false }

  const db = userDb(user.id)
  const [clients, prices] = await Promise.allSettled([
    db
      .selectFrom('clients')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('archived_at', 'is', null)
      .executeTakeFirstOrThrow(),
    db
      .selectFrom('prices')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('active', '=', true)
      .executeTakeFirstOrThrow(),
  ])

  return {
    customers: clients.status === 'fulfilled' && Number(clients.value.n) > 0,
    prices: prices.status === 'fulfilled' && Number(prices.value.n) > 0,
  }
}
