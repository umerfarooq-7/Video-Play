import Link from 'next/link'
import { requireUploader } from '@/lib/auth/guards'
import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import { formatDuration, formatRelativeTime } from '@/lib/format'
import { ClipTool } from './ClipTool'

export const metadata = { title: 'Clip tool' }

export default async function ClipsPage({ searchParams }: PageProps<'/studio/clips'>) {
  const profile = await requireUploader('/studio/clips')
  const params = await searchParams
  const sourceId = typeof params.source === 'string' ? params.source : null

  const supabase = await createClient()

  // Any of your own videos with playable media can be cut from — it does NOT
  // have to be published. That is the whole point of the workflow: you import
  // a full-length movie purely as a source, cut a short promo out of it, and
  // publish only the promo. Requiring the source to be published first would
  // mean putting the full movie live, which is exactly what must not happen.
  const { data: sources } = await supabase
    .from('videos')
    .select(
      'id, slug, title, status, duration_seconds, playback_hls_path, thumbnail_path, preview_sprite_path, projection, is_source_only, provider',
    )
    .eq('owner_id', profile.id)
    .not('playback_hls_path', 'is', null)
    .order('created_at', { ascending: false })

  const available = sources ?? []
  const selected = sourceId ? available.find((v) => v.id === sourceId) : null

  const { data: existingClips } = await supabase
    .from('clips')
    .select('id, title, start_seconds, end_seconds, is_promo, created_at, source_video_id')
    .eq('created_by', profile.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h2 className="text-lg font-bold">Clip tool</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Cut a short promo out of any of your videos — the source does not have
          to be published. Promos become videos in their own right, so they go
          through the same review before appearing publicly.
        </p>
      </div>

      {available.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">
            You need at least one video that has finished processing before you
            can cut a promo from it.
          </p>
          <Link
            href="/studio/videos"
            className="mt-3 inline-block text-xs font-medium text-accent hover:underline"
          >
            Go to my videos
          </Link>
        </div>
      ) : selected ? (
        <ClipTool
          source={{
            id: selected.id,
            title: selected.title,
            durationSeconds: selected.duration_seconds,
            playbackUrl: await getProviderFor(selected.provider).getPlaybackUrl(selected.playback_hls_path!),
            poster: getProviderFor(selected.provider).getThumbnailUrl(selected.thumbnail_path),
          }}
        />
      ) : (
        <div>
          <h3 className="mb-2 text-sm font-semibold">Choose a source video</h3>
          <ul className="space-y-2">
            {available.map((video) => (
              <li key={video.id}>
                <Link
                  href={`/studio/clips?source=${video.id}`}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface p-3 hover:border-accent"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">
                      {video.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      {formatDuration(video.duration_seconds)}
                      <span className="rounded bg-surface-raised px-1.5 py-0.5 text-[10px]">
                        {video.status.replace('_', ' ')}
                      </span>
                      {video.is_source_only && (
                        <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                          Source only
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-medium text-accent">
                    Cut →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(existingClips ?? []).length > 0 && (
        <section>
          <h3 className="mb-2 text-sm font-semibold">Your clips</h3>
          <ul className="space-y-1.5">
            {(existingClips ?? []).map((clip) => (
              <li
                key={clip.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-xs"
              >
                <span className="font-medium">{clip.title}</span>
                <span className="text-muted">
                  {formatDuration(Number(clip.start_seconds))} –{' '}
                  {formatDuration(Number(clip.end_seconds))}
                  {clip.is_promo && (
                    <span className="ml-2 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      Promo
                    </span>
                  )}
                  <span className="ml-2">{formatRelativeTime(clip.created_at)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
