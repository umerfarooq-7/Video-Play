import Image from 'next/image'
import Link from 'next/link'
import { requireStaff } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import { formatDuration, formatRelativeTime, isRemoteAsset } from '@/lib/format'
import { ModerationDecision } from './ModerationDecision'
import type { VideoStatus } from '@/types/database'

export const metadata = { title: 'Moderation queue' }

/**
 * The statuses this queue exposes as tabs, and the only accepted `?status=`.
 * Tabs are derived from this map, so adding one cannot leave the validator
 * behind and silently fall back to pending_review.
 */
const STATUS_LABELS = {
  pending_review: 'Awaiting review',
  published: 'Published',
  rejected: 'Rejected',
  removed: 'Removed',
  failed: 'Failed',
} as const satisfies Partial<Record<VideoStatus, string>>

const MODERATION_STATUSES = Object.keys(STATUS_LABELS) as (keyof typeof STATUS_LABELS)[]

export default async function ModerationPage({
  searchParams,
}: PageProps<'/admin/moderation'>) {
  await requireStaff('/admin/moderation')

  const params = await searchParams

  // Narrow the query-string value to a known status. Passing it through raw
  // would let any `?status=` string reach the query, and would only ever
  // return an empty list for an invalid one.
  const requested = typeof params.status === 'string' ? params.status : ''
  const status = MODERATION_STATUSES.includes(
    requested as keyof typeof STATUS_LABELS,
  )
    ? (requested as keyof typeof STATUS_LABELS)
    : 'pending_review'

  const supabase = await createClient()

  const { data: videos } = await supabase
    .from('videos')
    .select(
      `
      id, slug, title, description, status, duration_seconds, thumbnail_path,
      playback_hls_path, projection, provider, created_at, rights_attested,
      consent_attested, moderation_note,
      owner:profiles!videos_owner_id_fkey ( username, display_name )
    `,
    )
    .eq('status', status)
    .order('created_at', { ascending: true })
    .limit(50)

  const rows = videos ?? []

  const tabs = MODERATION_STATUSES.map((value) => ({
    value,
    label: STATUS_LABELS[value],
  }))

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">Moderation queue</h2>
        <p className="mt-0.5 text-xs text-muted">
          Oldest first. Nothing reaches the public grid without a decision here.
        </p>
      </div>

      <nav className="flex gap-1 overflow-x-auto scrollbar-none">
        {tabs.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/moderation?status=${tab.value}`}
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

      {rows.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing in this queue.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((video) => {
            const owner = Array.isArray(video.owner) ? video.owner[0] : video.owner
            const thumbnail = getProviderFor(video.provider).getThumbnailUrl(video.thumbnail_path)

            return (
              <li
                key={video.id}
                className="rounded-xl border border-border bg-surface p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-lg bg-background sm:w-44">
                    {thumbnail ? (
                      <Image
                        src={thumbnail}
                        alt=""
                        fill
                        sizes="176px"
                        unoptimized={isRemoteAsset(thumbnail)}
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-muted">
                        No thumbnail
                      </div>
                    )}
                    <span className="absolute bottom-1 right-1 rounded bg-black/80 px-1 py-0.5 text-[10px] tabular-nums text-white">
                      {formatDuration(video.duration_seconds)}
                    </span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold">{video.title}</h3>

                    <p className="mt-0.5 text-xs text-muted">
                      {owner?.display_name ?? owner?.username ?? 'Unknown'} ·
                      submitted {formatRelativeTime(video.created_at)} ·{' '}
                      {video.projection === 'flat' ? 'Flat' : video.projection}
                    </p>

                    {video.description && (
                      <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">
                        {video.description}
                      </p>
                    )}

                    {/* The attestations are the record that the uploader
                        claimed rights and consent. Surface them at the point
                        of decision, not buried in a detail page. */}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Attestation ok={video.rights_attested} label="Rights attested" />
                      <Attestation ok={video.consent_attested} label="Consent attested" />
                      {!video.playback_hls_path && (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          No playable media yet
                        </span>
                      )}
                    </div>

                    {video.moderation_note && (
                      <p className="mt-2 rounded-lg border border-border bg-background p-2 text-xs text-muted">
                        <span className="font-medium text-foreground">
                          Previous note:{' '}
                        </span>
                        {video.moderation_note}
                      </p>
                    )}

                    <ModerationDecision
                      videoId={video.id}
                      slug={video.slug}
                      status={video.status}
                      hasMedia={!!video.playback_hls_path}
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Attestation({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
        ok ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'
      }`}
    >
      {ok ? '✓' : '✗'} {label}
    </span>
  )
}
