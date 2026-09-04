import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { requireStaff } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'

export const metadata = { title: 'Admin' }

export default async function AdminOverviewPage() {
  const profile = await requireStaff('/admin')
  const supabase = await createClient()

  // `head: true` fetches only the count — no rows cross the wire.
  const [pendingApps, pendingVideos, openReports, publishedVideos] =
    await Promise.all([
      supabase
        .from('uploader_applications')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending'),
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_review'),
      supabase
        .from('reports')
        .select('id', { count: 'exact', head: true })
        .in('status', ['open', 'triaged']),
      supabase
        .from('videos')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'published'),
    ])

  const isAdmin = profile.role === 'admin'

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-bold">Overview</h2>
        <p className="mt-0.5 text-xs text-muted">
          Signed in as {profile.username} ({profile.role}).
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <QueueCard
          label="Videos awaiting review"
          count={pendingVideos.count ?? 0}
          href="/admin/moderation"
          urgent={(pendingVideos.count ?? 0) > 0}
        />
        <QueueCard
          label="Open reports"
          count={openReports.count ?? 0}
          href="/admin/reports"
          urgent={(openReports.count ?? 0) > 0}
        />
        {isAdmin && (
          <QueueCard
            label="Uploader applications"
            count={pendingApps.count ?? 0}
            href="/admin/uploaders"
            urgent={(pendingApps.count ?? 0) > 0}
          />
        )}
        <QueueCard
          label="Published videos"
          count={publishedVideos.count ?? 0}
          href="/admin/moderation?status=published"
        />
      </div>
    </div>
  )
}

function QueueCard({
  label,
  count,
  href,
  urgent = false,
}: {
  label: string
  count: number
  href: string
  urgent?: boolean
}) {
  return (
    <Link
      href={href}
      className={`group rounded-xl border p-4 transition-colors ${
        urgent
          ? 'border-accent/40 bg-accent/5 hover:border-accent'
          : 'border-border bg-surface hover:border-muted'
      }`}
    >
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p
        className={`mt-1 text-2xl font-bold tabular-nums ${
          urgent ? 'text-accent' : 'text-foreground'
        }`}
      >
        {count}
      </p>
      <span className="mt-1 inline-flex items-center gap-0.5 text-xs text-muted group-hover:text-accent">
        Open
        <ArrowRight size={12} aria-hidden />
      </span>
    </Link>
  )
}
