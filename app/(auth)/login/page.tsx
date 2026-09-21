import type { Metadata } from 'next'

import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams

  const next = typeof params.next === 'string' && params.next.startsWith('/') && !params.next.startsWith('//') ? params.next : '/dashboard'
  const error = typeof params.error === 'string' ? params.error : undefined
  const email = typeof params.email === 'string' ? params.email : undefined
  // Set by /auth/verify when the link was opened without a session (e.g. on a
  // phone): the address is confirmed, they just need to sign in.
  const message = params.verified === '1' ? 'Email verified. Sign in to continue.' : undefined

  return <LoginForm next={next} initialError={error} initialMessage={message} initialEmail={email} />
}
