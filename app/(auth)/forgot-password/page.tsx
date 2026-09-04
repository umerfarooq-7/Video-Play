import Link from 'next/link'
import { ForgotPasswordForm } from './ForgotPasswordForm'

export const metadata = {
  title: 'Reset password',
  robots: { index: false, follow: false },
}

export default function ForgotPasswordPage() {
  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <h1 className="text-lg font-bold">Reset your password</h1>
      <p className="mt-1 text-xs text-muted">
        We&apos;ll email you a link to choose a new one.
      </p>

      <ForgotPasswordForm />

      <p className="mt-4 text-xs text-muted">
        <Link href="/login" className="hover:text-accent">
          Back to log in
        </Link>
      </p>
    </div>
  )
}
