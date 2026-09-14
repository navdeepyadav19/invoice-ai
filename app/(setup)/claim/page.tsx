import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ClaimForm } from '@/components/auth/claim-form'
import { createClient } from '@/lib/supabase/server'
import { requireUser } from '@/lib/queries'

export const metadata: Metadata = { title: 'Save your work' }

export default async function ClaimPage() {
  const user = await requireUser()

  // Only guests have anything to claim.
  if (!user.is_anonymous) redirect('/dashboard')

  const supabase = await createClient()
  const { count } = await supabase
    .from('invoices')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', user.id)

  return (
    <div className="mx-auto max-w-sm py-6">
      <ClaimForm invoiceCount={count ?? 0} />
    </div>
  )
}
