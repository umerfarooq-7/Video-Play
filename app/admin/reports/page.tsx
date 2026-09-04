import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { requireStaff } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/format'
import { ReportActions } from './ReportActions'
import type { ReportReason, ReportStatus } from '@/types/database'

export const metadata = { title: 'Reports' }

/** Reports that must jump the queue. Safety before copyright, always. */
const URGENT: ReportReason[] = ['csam', 'underage', 'non_consensual']

const REASON_LABELS: Record<ReportReason, string> = {
  csam: 'Involves a minor',
  underage: 'Performer appears underage',
  non_consensual: 'Published without consent',
  copyright: 'Copyright infringement',
  violence: 'Violent or extreme content',
  spam: 'Spam or misleading',
  wrong_category: 'Wrong category or tags',
  broken: 'Video does not play',
  other: 'Other',
}

const STATUS_TABS: { value: ReportStatus; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'actioned', label: 'Actioned' },
  { value: 'dismissed', label: 'Dismissed' },
]

export default async function ReportsPage({
  searchParams,
}: PageProps<'/admin/reports'>) {
  await requireStaff('/admin/reports')

  const params = await searchParams
  const requested = typeof params.status === 'string' ? params.status : ''
  const status: ReportStatus = STATUS_TABS.some((t) => t.value === requested)
    ? (requested as ReportStatus)
    : 'open'

  const supabase = await createClient()

  const { data: reports } = await supabase
    .from('reports')
    .select(
      `
      id, reason, detail, status, reporter_email, created_at, resolution,
      video:videos!reports_video_id_fkey ( id, slug, title, status )
    `,
    )
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(100)

  const rows = reports ?? []

  // Urgent categories float to the top regardless of age.
  const sorted = [...rows].sort((a, b) => {
    const aUrgent = URGENT.includes(a.reason as ReportReason) ? 0 : 1
    const bUrgent = URGENT.includes(b.reason as ReportReason) ? 0 : 1
    return aUrgent - bUrgent
  })

  const urgentCount = rows.filter((r) =>
    URGENT.includes(r.reason as ReportReason),
  ).length

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Reports</h2>
        <p className="mt-0.5 text-xs text-muted">
          {rows.length} report{rows.length === 1 ? '' : 's'} in this queue.
        </p>
      </div>

      {urgentCount > 0 && status === 'open' && (
        <div className="flex items-start gap-2 rounded-xl border border-danger/40 bg-danger/10 p-3">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-danger" aria-hidden />
          <p className="text-xs leading-relaxed text-danger">
            <strong>
              {urgentCount} safety report{urgentCount === 1 ? '' : 's'} need
              immediate attention.
            </strong>{' '}
            Reports of minors or non-consensual content are handled before
            everything else. Take the video down first, review afterwards.
          </p>
        </div>
      )}

      <nav className="flex gap-1 overflow-x-auto scrollbar-none">
        {STATUS_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/reports?status=${tab.value}`}
            aria-current={status === tab.value ? 'page' : undefined}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${
              status === tab.value
                ? 'bg-accent text-accent-contrast'
                : 'text-muted hover:bg-surface hover:text-foreground'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {sorted.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((report) => {
            const video = Array.isArray(report.video) ? report.video[0] : report.video
            const urgent = URGENT.includes(report.reason as ReportReason)

            return (
              <li
                key={report.id}
                className={`rounded-xl border bg-surface p-4 ${
                  urgent ? 'border-danger/40' : 'border-border'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                      urgent
                        ? 'bg-danger/15 text-danger'
                        : 'bg-surface-raised text-muted'
                    }`}
                  >
                    {REASON_LABELS[report.reason as ReportReason]}
                  </span>
                  <span className="text-xs text-muted">
                    {formatRelativeTime(report.created_at)}
                  </span>
                </div>

                {video ? (
                  <p className="mt-2 text-sm font-medium">
                    <Link href={`/watch/${video.slug}`} className="hover:text-accent">
                      {video.title}
                    </Link>
                    <span className="ml-2 text-xs font-normal text-muted">
                      ({video.status})
                    </span>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-muted">Video no longer exists.</p>
                )}

                {report.detail && (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg border border-border bg-background p-2 text-xs leading-relaxed text-muted">
                    {report.detail}
                  </p>
                )}

                {report.reporter_email && (
                  <p className="mt-1.5 text-xs text-muted">
                    Reporter contact: {report.reporter_email}
                  </p>
                )}

                {report.resolution && (
                  <p className="mt-1.5 text-xs text-muted">
                    <span className="font-medium text-foreground">Resolution: </span>
                    {report.resolution}
                  </p>
                )}

                {(status === 'open' || status === 'triaged') && (
                  <ReportActions
                    reportId={report.id}
                    videoId={video?.id ?? null}
                    videoStatus={video?.status ?? null}
                    urgent={urgent}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
