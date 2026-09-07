import Image from 'next/image'
import Link from 'next/link'
import { requireAdmin } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import {
  formatCount,
  formatDuration,
  formatRelativeTime,
  isRemoteAsset,
} from '@/lib/format'
import { VideoAdminRow } from './VideoAdminRow'
import type { VideoStatus } from '@/types/database'

export const metadata = { title: 'All videos' }

/** Filter tabs. `all` is the default because this page exists to see everything. */
const STATUS_LABELS = {
  all: 'All',
  published: 'Published',
  pending_review: 'In review',
  processing: 'Processing',
  draft: 'Draft',
  uploading: 'Uploading',
  rejected: 'Rejected',
  removed: 'Removed',
  failed: 'Failed',
} as const

type Filter = keyof typeof STATUS_LABELS

const BADGE: Record<string, string> = {
  published: 'bg-success/15 text-success',
  pending_review: 'bg-warning/15 text-warning',
  processing: 'bg-warning/15 text-warning',
  uploading: 'bg-warning/15 text-warning',
  draft: 'bg-surface-raised text-muted',
  rejected: 'bg-danger/15 text-danger',
  removed: 'bg-danger/15 text-danger',
  failed: 'bg-danger/15 text-danger',
}

export default async function AdminVideosPage({
  searchParams,
}: PageProps<'/admin/videos'>) {
  await requireAdmin('/admin/videos')

  const params = await searchParams
  const requested = typeof params.status === 'string' ? params.status : ''
  const filter: Filter = requested in STATUS_LABELS ? (requested as Filter) : 'all'

  const supabase = await createClient()

  // Staff RLS exposes every row regardless of status, which is the whole point
  // of this page — the moderation queue only ever shows one status at a time.
  let builder = supabase
    .from('videos')
    .select(
      `
      id, slug, title, status, duration_seconds, thumbnail_path, provider,
      playback_hls_path, view_count, created_at,
      owner:profiles!videos_owner_id_fkey ( username ),
      paysite:paysites!videos_paysite_id_fkey ( name, domain )
    `,
      { count: 'exact' },
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (filter !== 'all') builder = builder.eq('status', filter)

  const { data: videos, count } = await builder
  const rows = videos ?? []

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">All videos</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Every video on the site, whatever its status. Deleting here removes
          the record <strong>and</strong> the file from the CDN — use the
          moderation queue&apos;s take-down instead if you only want it hidden.
        </p>
      </div>

      <nav className="flex flex-wrap gap-1">
        {(Object.keys(STATUS_LABELS) as Filter[]).map((key) => (
          <Link
            key={key}
            href={key === 'all' ? '/admin/videos' : `/admin/videos?status=${key}`}
            aria-current={filter === key ? 'page' : undefined}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              filter === key
                ? 'bg-accent text-accent-contrast'
                : 'text-muted hover:bg-surface hover:text-foreground'
            }`}
          >
            {STATUS_LABELS[key]}
          </Link>
        ))}
      </nav>

      <p className="text-xs text-muted">
        {count ?? rows.length} video{(count ?? rows.length) === 1 ? '' : 's'}
        {rows.length === 200 && ' (showing the 200 most recent)'}
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((video) => {
            const owner = Array.isArray(video.owner) ? video.owner[0] : video.owner
            const paysite = Array.isArray(video.paysite)
              ? video.paysite[0]
              : video.paysite
            const thumbnail = getProviderFor(video.provider).getThumbnailUrl(
              video.thumbnail_path,
            )

            return (
              <li
                key={video.id}
                className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row"
              >
                <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-background sm:w-32">
                  {thumbnail ? (
                    <Image
                      src={thumbnail}
                      alt=""
                      fill
                      sizes="128px"
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
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        BADGE[video.status] ?? 'bg-surface-raised text-muted'
                      }`}
                    >
                      {STATUS_LABELS[video.status as Filter] ?? video.status}
                    </span>
                  </div>

                  <p className="mt-0.5 text-xs text-muted">
                    {paysite ? paysite.name : 'No network'}
                    {owner && ` · @${owner.username}`}
                    {' · '}
                    {formatCount(video.view_count)} views · added{' '}
                    {formatRelativeTime(video.created_at)}
                  </p>

                  <VideoAdminRow
                    videoId={video.id}
                    title={video.title}
                    slug={video.slug}
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
