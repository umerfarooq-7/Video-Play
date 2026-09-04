import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/supabase/server'
import { SignupForm } from './SignupForm'

export const metadata = {
  title: 'Sign up',
  robots: { index: false, follow: false },
}

export default async function SignupPage() {
  const user = await getCurrentUser()
  if (user) redirect('/')

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h1 className="text-lg font-bold">Create an account</h1>
      <p className="mt-1 text-xs text-muted">
        Free. Uploading requires separate approval.
      </p>

      <SignupForm />

      <p className="mt-4 text-xs text-muted">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Log in
        </Link>
      </p>
    </div>
  )
}
