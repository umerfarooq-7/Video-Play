import Link from 'next/link'
import { Upload, Video, Scissors, LayoutDashboard, Link2 } from 'lucide-react'
import { requireProfile } from '@/lib/auth/guards'

/**
 * Creator studio shell.
 *
 * The nav adapts to approval state rather than showing links that would only
 * bounce the user back to /studio/apply.
 */
export default async function StudioLayout({ children }: LayoutProps<'/studio'>) {
  const profile = await requireProfile('/studio')
  const approved = profile.uploader_status === 'approved'

  const links = [
    { href: '/studio', label: 'Overview', icon: LayoutDashboard, always: true },
    { href: '/studio/videos', label: 'My videos', icon: Video, always: false },
    { href: '/studio/upload', label: 'Upload', icon: Upload, always: false },
    { href: '/studio/import', label: 'Import from URL', icon: Link2, always: false },
    { href: '/studio/clips', label: 'Clip tool', icon: Scissors, always: false },
  ].filter((link) => link.always || approved)

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="lg:w-52 lg:shrink-0">
        <h1 className="mb-3 text-sm font-bold">Creator studio</h1>

        <nav className="flex gap-1 overflow-x-auto scrollbar-none lg:flex-col lg:overflow-visible">
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted hover:bg-surface hover:text-foreground"
            >
              <Icon size={15} aria-hidden />
              {label}
            </Link>
          ))}
        </nav>

        <div className="mt-4 hidden rounded-lg border border-border bg-surface p-3 lg:block">
          <p className="text-[10px] uppercase tracking-wider text-muted">
            Uploader status
          </p>
          <UploaderBadge status={profile.uploader_status} />
        </div>
      </aside>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function UploaderBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    approved: 'text-success',
    pending: 'text-warning',
    rejected: 'text-danger',
    suspended: 'text-danger',
    none: 'text-muted',
  }

  const labels: Record<string, string> = {
    approved: 'Approved',
    pending: 'Awaiting review',
    rejected: 'Not approved',
    suspended: 'Suspended',
    none: 'Not applied',
  }

  return (
    <p className={`mt-1 text-xs font-semibold ${styles[status] ?? 'text-muted'}`}>
      {labels[status] ?? status}
    </p>
  )
}
