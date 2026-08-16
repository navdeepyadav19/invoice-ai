import type { Metadata } from 'next'

import { LoginForm } from '@/components/auth/login-form'

export const metadata: Metadata = { title: 'Sign in' }

export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams

  const next = typeof params.next === 'string' && params.next.startsWith('/') ? params.next : '/dashboard'
  const error = typeof params.error === 'string' ? params.error : undefined

  return <LoginForm next={next} initialError={error} />
}
