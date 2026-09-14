import type { Metadata } from 'next'

import { CheckEmail } from '@/components/auth/check-email'

export const metadata: Metadata = { title: 'Check your inbox' }

export default async function CheckEmailPage({ searchParams }: PageProps<'/signup/check-email'>) {
  const params = await searchParams
  const email = typeof params.email === 'string' ? params.email : ''

  return <CheckEmail email={email} />
}
