import Image from 'next/image'
import Link from 'next/link'
import { requireUploader } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import { formatCount, formatDuration, formatRelativeTime, isRemoteAsset } from '@/lib/format'
import { VideoRowActions } from './VideoRowActions'
import type { VideoStatus } from '@/types/database'

export const metadata = { title: 'My videos' }

const STATUS_STYLES: Record<VideoStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-surface-raised text-muted' },
  uploading: { label: 'Uploading', className: 'bg-warning/15 text-warning' },
  processing: { label: 'Processing', className: 'bg-warning/15 text-warning' },
  pending_review: { label: 'In review', className: 'bg-warning/15 text-warning' },
  published: { label: 'Published', className: 'bg-success/15 text-success' },
  rejected: { label: 'Rejected', className: 'bg-danger/15 text-danger' },
  removed: { label: 'Removed', className: 'bg-danger/15 text-danger' },
  failed: { label: 'Failed', className: 'bg-danger/15 text-danger' },
}

export default async function StudioVideosPage() {
  const profile = await requireUploader('/studio/videos')
  const supabase = await createClient()

  const { data: videos } = await supabase
    .from('videos')
    .select(
      'id, slug, title, status, duration_seconds, thumbnail_path, view_count, like_count, created_at, moderation_note, playback_hls_path, provider',
    )
    .eq('owner_id', profile.id)
    .order('created_at', { ascending: false })

  const rows = videos ?? []

  // Surface the latest job per video so "Processing" can show a reason when it
  // has actually failed, rather than spinning forever.
  const { data: jobs } = await supabase
    .from('ingest_jobs')
    .select('video_id, status, progress, error, created_at')
    .eq('requested_by', profile.id)
    .order('created_at', { ascending: false })

  // `jobs` is nullable, so index the non-null form to get the row type.
  const latestJob = new Map<string, NonNullable<typeof jobs>[number]>()
  for (const job of jobs ?? []) {
    if (!latestJob.has(job.video_id)) latestJob.set(job.video_id, job)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">My videos</h2>
          <p className="mt-0.5 text-xs text-muted">
            {rows.length} video{rows.length === 1 ? '' : 's'}
          </p>
        </div>
        <Link
          href="/studio/upload"
          className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
        >
          Upload
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">You have not uploaded anything yet.</p>
          <Link
            href="/studio/upload"
            className="mt-3 inline-block rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            Upload your first video
          </Link>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((video) => {
            const status = STATUS_STYLES[video.status as VideoStatus]
            const job = latestJob.get(video.id)
            const thumbnail = getProviderFor(video.provider).getThumbnailUrl(video.thumbnail_path)

            return (
              <li
                key={video.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row"
              >
                <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-background sm:w-40">
                  {thumbnail ? (
                    <Image
                      src={thumbnail}
                      alt=""
                      fill
                      sizes="160px"
                      unoptimized={isRemoteAsset(thumbnail)}
                      className="object-cover"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-[10px] text-muted">
                      No thumbnail
                    </div>
                  )}
                  <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] tabular-nums text-white">
                    {formatDuration(video.duration_seconds)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-semibold">{video.title}</h3>
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${status.className}`}
                    >
                      {status.label}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    {formatCount(video.view_count)} views ·{' '}
                    {formatCount(video.like_count)} likes · added{' '}
                    {formatRelativeTime(video.created_at)}
                  </p>

                  {video.status === 'processing' && job?.status === 'running' && (
                    <div className="mt-2">
                      <div
                        role="progressbar"
                        aria-valuenow={job.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-raised"
                      >
                        <div
                          className="h-full bg-accent"
                          style={{ width: `${job.progress}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-muted">
                        Processing {job.progress}%
                      </p>
                    </div>
                  )}

                  {job?.status === 'queued' && (
                    <p className="mt-1.5 text-[11px] text-muted">
                      Waiting for a worker to pick this up.
                    </p>
                  )}

                  {job?.error && (
                    <p className="mt-1.5 rounded-lg border border-danger/30 bg-danger/10 p-2 text-[11px] text-danger">
                      {job.error}
                    </p>
                  )}

                  {video.moderation_note && (
                    <p className="mt-1.5 rounded-lg border border-border bg-background p-2 text-[11px] text-muted">
                      <span className="font-medium text-foreground">
                        Moderator:{' '}
                      </span>
                      {video.moderation_note}
                    </p>
                  )}

                  <VideoRowActions
                    videoId={video.id}
                    slug={video.slug}
                    status={video.status as VideoStatus}
                    hasMedia={!!video.playback_hls_path}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
