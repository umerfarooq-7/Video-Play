import Link from 'next/link'
import { Upload, Link2, ArrowRight } from 'lucide-react'
import { requireProfile } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { formatCount } from '@/lib/format'

export const metadata = { title: 'Creator studio' }

export default async function StudioPage() {
  const profile = await requireProfile('/studio')
  const supabase = await createClient()

  const approved = profile.uploader_status === 'approved'

  // RLS already scopes videos to the owner, but filtering explicitly keeps the
  // intent readable and the query planner honest.
  const { data: videos } = await supabase
    .from('videos')
    .select('id, status, view_count')
    .eq('owner_id', profile.id)

  const rows = videos ?? []
  const published = rows.filter((v) => v.status === 'published')
  const inReview = rows.filter(
    (v) => v.status === 'pending_review' || v.status === 'processing',
  )
  const totalViews = published.reduce((sum, v) => sum + (v.view_count ?? 0), 0)

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold">
          Welcome back, {profile.display_name ?? profile.username}
        </h2>
        <p className="mt-0.5 text-xs text-muted">
          {approved
            ? 'Upload, manage and cut clips from your videos.'
            : 'Apply for upload access to publish videos.'}
        </p>
      </div>

      {!approved && <ApplicationPrompt status={profile.uploader_status} />}

      {approved && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Published" value={String(published.length)} />
            <Stat label="In review" value={String(inReview.length)} />
            <Stat label="Total views" value={formatCount(totalViews)} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <ActionCard
              href="/studio/upload"
              icon={<Upload size={18} aria-hidden />}
              title="Upload a video"
              description="Send a file straight from your device."
            />
            <ActionCard
              href="/studio/import"
              icon={<Link2 size={18} aria-hidden />}
              title="Import from a link"
              description="Paste a direct download URL and we fetch it."
            />
          </div>
        </>
      )}
    </div>
  )
}

function ApplicationPrompt({ status }: { status: string }) {
  if (status === 'pending') {
    return (
      <div className="rounded-xl border border-warning/30 bg-warning/10 p-4">
        <h3 className="text-sm font-semibold text-warning">
          Your application is under review
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          A moderator will look at it shortly. You will be able to upload as
          soon as it is approved.
        </p>
      </div>
    )
  }

  if (status === 'suspended') {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-4">
        <h3 className="text-sm font-semibold text-danger">
          Upload access suspended
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Contact support to discuss reinstatement. Reapplying will not lift a
          suspension.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="text-sm font-semibold">
        {status === 'rejected'
          ? 'Your previous application was not approved'
          : 'Become an uploader'}
      </h3>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Uploading requires approval. Tell us who you are and confirm you hold
        the rights and performer consent for everything you publish.
      </p>
      <Link
        href="/studio/apply"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
      >
        {status === 'rejected' ? 'Apply again' : 'Apply for access'}
        <ArrowRight size={13} aria-hidden />
      </Link>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
    </div>
  )
}

function ActionCard({
  href,
  icon,
  title,
  description,
}: {
  href: string
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-xl border border-border bg-surface p-4 hover:border-accent"
    >
      <span className="text-accent">{icon}</span>
      <h3 className="mt-2 text-sm font-semibold group-hover:text-accent">
        {title}
      </h3>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
    </Link>
  )
}
