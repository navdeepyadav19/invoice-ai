import type { Metadata } from 'next'
import { redirect } from 'next/navigation'

import { ResetPasswordForm } from '@/components/auth/password-forms'
import { getUser } from '@/lib/supabase/server'

export const metadata: Metadata = { title: 'Choose a new password' }

export default async function ResetPasswordPage() {
  // Landing here without a session means the recovery link was never followed
  // (or has expired). Send them back rather than showing a form that can't save.
  const user = await getUser()
  if (!user) redirect('/forgot-password')

  return <ResetPasswordForm />
}
