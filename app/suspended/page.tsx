import Link from 'next/link'
import { logOut } from '@/lib/auth/actions'
import { SubmitButton } from '@/components/form'

export const metadata = {
  title: 'Account suspended',
  robots: { index: false, follow: false },
}

/**
 * Where requireProfile() sends a banned account.
 *
 * Deliberately does not state the reason: a suspension notice is not the place
 * to disclose what moderation found, and appeals go through a human.
 */
export default function SuspendedPage() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center">
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-6">
        <h1 className="text-lg font-bold text-danger">Account suspended</h1>

        <p className="mt-2 text-sm leading-relaxed text-muted">
          This account has been suspended and cannot be used to browse, upload
          or comment.
        </p>

        <p className="mt-3 text-sm leading-relaxed text-muted">
          If you believe this is a mistake, contact support to appeal. Creating
          another account will not restore access and may result in that account
          being suspended too.
        </p>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <form action={logOut}>
            <SubmitButton variant="secondary" pendingLabel="Signing out…">
              Log out
            </SubmitButton>
          </form>
          <Link
            href="/legal/terms"
            className="rounded-lg px-3.5 py-2 text-xs font-medium text-muted hover:text-foreground"
          >
            Terms of service
          </Link>
        </div>
      </div>
    </div>
  )
}
