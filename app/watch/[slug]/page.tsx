import { notFound } from 'next/navigation'
import Link from 'next/link'
import { headers } from 'next/headers'
import { Eye, Calendar, Globe } from 'lucide-react'
import { createClient, getCurrentUser } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import { listVideos } from '@/lib/queries'
import { isVideoAvailableIn } from '@/lib/geo'
import { COUNTRY_HEADER } from '@/lib/constants'
import { formatCount, formatRelativeTime, ratingPercent } from '@/lib/format'
import { Player } from '@/components/player/Player'
import { VideoGrid } from '@/components/VideoCard'
import { WatchActions } from './WatchActions'
import { ViewCounter } from './ViewCounter'
import type { Video, VideoProjection } from '@/types/database'

type WatchRow = Video & {
  owner: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
  } | null
  video_categories: { categories: { id: string; slug: string; name: string } | null }[]
  video_tags: { tags: { id: string; slug: string; name: string } | null }[]
}

async function loadVideo(slug: string) {
  const supabase = await createClient()

  const { data } = await supabase
    .from('videos')
    .select(
      `
      *,
      owner:profiles!videos_owner_id_fkey ( id, username, display_name, avatar_url ),
      video_categories ( categories ( id, slug, name ) ),
      video_tags ( tags ( id, slug, name ) )
    `,
    )
    .eq('slug', slug)
    .maybeSingle()

  return (data as unknown as WatchRow | null) ?? null
}

export async function generateMetadata({ params }: PageProps<'/watch/[slug]'>) {
  const { slug } = await params
  const video = await loadVideo(slug)

  if (!video || video.status !== 'published') {
    return { title: 'Video not found', robots: { index: false, follow: false } }
  }

  const provider = getProviderFor(video.provider)
  const thumbnail = provider.getThumbnailUrl(video.thumbnail_path)

  return {
    title: video.title,
    description: video.description?.slice(0, 160) ?? `Watch ${video.title}.`,
    openGraph: {
      title: video.title,
      description: video.description?.slice(0, 160) ?? undefined,
      type: 'video.other',
      images: thumbnail ? [thumbnail] : undefined,
    },
  }
}

export default async function WatchPage({ params }: PageProps<'/watch/[slug]'>) {
  const { slug } = await params
  const video = await loadVideo(slug)

  // RLS lets the owner and staff see unpublished rows so they can preview.
  if (!video) notFound()

  const [user, headerList] = await Promise.all([getCurrentUser(), headers()])
  const country = headerList.get(COUNTRY_HEADER) || null

  const isOwner = user?.id === video.owner_id
  const isPublished = video.status === 'published'

  if (!isPublished && !isOwner) {
    // Staff can still reach it through the moderation queue's preview link;
    // for everyone else an unpublished video simply does not exist.
    const supabase = await createClient()
    const { data: staff } = await supabase.rpc('is_staff')
    if (!staff) notFound()
  }

  // Geo-availability. Enforced here as well as in list queries, because a
  // direct link bypasses the grid entirely.
  const available = isVideoAvailableIn(
    country,
    video.allowed_countries ?? [],
    video.blocked_countries ?? [],
  )

  if (!available && !isOwner) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <Globe size={32} className="mx-auto text-muted" aria-hidden />
        <h1 className="mt-3 text-lg font-bold">Not available in your region</h1>
        <p className="mt-1 text-sm text-muted">
          The uploader has restricted where this video can be watched.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          Browse other videos
        </Link>
      </div>
    )
  }

  const provider = getProviderFor(video.provider)
  const playbackUrl = video.playback_hls_path
    ? await provider.getPlaybackUrl(video.playback_hls_path, {
        expiresInSeconds: 60 * 60 * 4,
        countryCode: country,
      })
    : null
  const poster = provider.getThumbnailUrl(video.thumbnail_path)

  const categories = video.video_categories
    .map((link) => link.categories)
    .filter((c): c is NonNullable<typeof c> => !!c)
  const tags = video.video_tags
    .map((link) => link.tags)
    .filter((t): t is NonNullable<typeof t> => !!t)

  // Related: same first category where possible, else recent.
  const { videos: related } = await listVideos({
    perPage: 12,
    country,
    sort: 'views',
  })

  const rating = ratingPercent(video.like_count, video.dislike_count)

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-4">
        {!isPublished && (
          <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
            This video is <strong>{video.status.replace('_', ' ')}</strong> and is
            not visible to the public.
            {video.moderation_note && (
              <>
                {' '}
                Moderator note: {video.moderation_note}
              </>
            )}
          </p>
        )}

        {playbackUrl ? (
          <Player
            src={playbackUrl}
            poster={poster}
            projection={video.projection as VideoProjection}
          />
        ) : (
          <div className="grid aspect-video w-full place-items-center rounded-xl border border-border bg-surface text-center">
            <div>
              <p className="text-sm font-medium">Still processing</p>
              <p className="mt-1 text-xs text-muted">
                This video has no playable media yet. Check back shortly.
              </p>
            </div>
          </div>
        )}

        <div>
          <h1 className="text-lg font-bold leading-snug">{video.title}</h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <Eye size={13} aria-hidden />
              {formatCount(video.view_count)} views
            </span>
            {rating !== null && <span>{rating}% liked</span>}
            {video.published_at && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={13} aria-hidden />
                {formatRelativeTime(video.published_at)}
              </span>
            )}
          </div>
        </div>

        <WatchActions
          videoId={video.id}
          likeCount={video.like_count}
          dislikeCount={video.dislike_count}
          signedIn={!!user}
        />

        {video.owner && (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-surface p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-surface-raised text-sm font-bold uppercase">
              {(video.owner.display_name ?? video.owner.username).charAt(0)}
            </span>
            <div className="min-w-0">
              <Link
                href={`/u/${video.owner.username}`}
                className="block truncate text-sm font-semibold hover:text-accent"
              >
                {video.owner.display_name ?? video.owner.username}
              </Link>
              <p className="text-xs text-muted">@{video.owner.username}</p>
            </div>
          </div>
        )}

        {video.description && (
          <div className="rounded-xl border border-border bg-surface p-3">
            <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted">
              {video.description}
            </p>
          </div>
        )}

        {(categories.length > 0 || tags.length > 0) && (
          <div className="flex flex-wrap gap-1.5">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={`/category/${category.slug}`}
                className="rounded-full bg-surface-raised px-2.5 py-1 text-xs text-muted hover:text-accent"
              >
                {category.name}
              </Link>
            ))}
            {tags.map((tag) => (
              <Link
                key={tag.id}
                href={`/search?q=${encodeURIComponent(tag.name)}`}
                className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:text-accent"
              >
                #{tag.name}
              </Link>
            ))}
          </div>
        )}

        {/* Fires once on mount; the RPC behind it de-duplicates per viewer. */}
        {isPublished && <ViewCounter videoId={video.id} />}
      </div>

      <aside className="min-w-0">
        <h2 className="mb-3 text-sm font-semibold">Up next</h2>
        <div className="[&_.grid]:grid-cols-2 lg:[&_.grid]:grid-cols-1">
          <VideoGrid videos={related.filter((v) => v.id !== video.id).slice(0, 8)} emptyMessage="Nothing else published yet." />
        </div>
      </aside>
    </div>
  )
}
