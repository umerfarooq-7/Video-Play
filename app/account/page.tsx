import Link from 'next/link'
import { requireProfile } from '@/lib/auth/guards'
import { AccountForm } from './AccountForm'
import { PasswordForm } from './PasswordForm'
import { logOut } from '@/lib/auth/actions'
import { SubmitButton } from '@/components/form'

export const metadata = {
  title: 'Account settings',
  robots: { index: false, follow: false },
}

export default async function AccountPage() {
  const profile = await requireProfile('/account')

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <h1 className="text-lg font-bold">Account settings</h1>
        <p className="mt-0.5 text-xs text-muted">
          Your public profile is at{' '}
          <Link href={`/u/${profile.username}`} className="text-accent hover:underline">
            /u/{profile.username}
          </Link>
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Profile</h2>
        <AccountForm profile={profile} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Password</h2>
        <PasswordForm />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold">Session</h2>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted">
            Signed in as {profile.username}. Logging out ends this session on
            this device only.
          </p>
          <form action={logOut} className="mt-3">
            <SubmitButton variant="secondary" pendingLabel="Signing out…">
              Log out
            </SubmitButton>
          </form>
        </div>
      </section>
    </div>
  )
}
