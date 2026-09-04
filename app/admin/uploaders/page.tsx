import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { formatRelativeTime } from '@/lib/format'
import { UploaderDecision } from './UploaderDecision'

export const metadata = { title: 'Uploader applications' }

export default async function UploaderApplicationsPage() {
  await requireAdmin('/admin/uploaders')
  const supabase = await createClient()

  const { data: applications } = await supabase
    .from('uploader_applications')
    .select(
      `
      id, statement, site_url, status, created_at, review_note, reviewed_at,
      applicant:profiles!uploader_applications_user_id_fkey (
        id, username, display_name, created_at
      )
    `,
    )
    .eq('status', 'pending')
    .order('created_at', { ascending: true })

  const rows = applications ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Uploader applications</h2>
        <p className="mt-0.5 text-xs text-muted">
          {rows.length === 0
            ? 'Nothing waiting.'
            : `${rows.length} awaiting review, oldest first.`}
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          No pending applications.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((application) => {
            // PostgREST types an embedded one-to-one as a possible array;
            // normalise so the JSX below reads cleanly.
            const applicant = Array.isArray(application.applicant)
              ? application.applicant[0]
              : application.applicant

            return (
              <li
                key={application.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold">
                    {applicant?.display_name ?? applicant?.username ?? 'Unknown user'}
                    {applicant?.username && (
                      <span className="ml-1.5 font-normal text-muted">
                        @{applicant.username}
                      </span>
                    )}
                  </h3>
                  <span className="text-xs text-muted">
                    applied {formatRelativeTime(application.created_at)}
                  </span>
                </div>

                <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-muted">
                  {application.statement}
                </p>

                {application.site_url && (
                  <p className="mt-2 text-xs">
                    <span className="text-muted">Site: </span>
                    {/* Untrusted user input: noopener/noreferrer, and
                        nofollow so an application cannot be used for SEO. */}
                    <a
                      href={application.site_url}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="text-accent hover:underline"
                    >
                      {application.site_url}
                    </a>
                  </p>
                )}

                <UploaderDecision applicationId={application.id} />
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
