import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { LoginForm } from './LoginForm'

export const metadata = {
  title: 'Log in',
  robots: { index: false, follow: false },
}

/**
 * Server component so `next` comes from awaited searchParams rather than
 * `useSearchParams`, which would need a Suspense boundary to prerender.
 */
export default async function LoginPage({ searchParams }: PageProps<'/login'>) {
  const params = await searchParams
  const next = typeof params.next === 'string' ? params.next : '/'

  // Already signed in? Nothing to do here.
  const user = await getCurrentUser()
  if (user) redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/')

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h1 className="text-lg font-bold">Log in</h1>
      <p className="mt-1 text-xs text-muted">Welcome back.</p>

      <LoginForm next={next} />

      <div className="mt-4 space-y-1.5 text-xs text-muted">
        <p>
          <Link href="/forgot-password" className="hover:text-accent">
            Forgot your password?
          </Link>
        </p>
        <p>
          No account?{' '}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
