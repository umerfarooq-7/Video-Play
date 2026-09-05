import Link from 'next/link'
import { Eye, ThumbsUp, Glasses } from 'lucide-react'
import { VideoThumb } from '@/components/VideoThumb'
import {
  formatCount,
  formatDuration,
  formatRelativeTime,
  ratingPercent,
} from '@/lib/format'
import type { VideoCardData } from '@/lib/queries'

interface Props {
  video: VideoCardData
  /** Eager-load the first row so the largest contentful paint is a thumbnail. */
  priority?: boolean
}

export function VideoCard({ video, priority = false }: Props) {
  const rating = ratingPercent(video.likeCount, video.dislikeCount)
  const immersive = video.projection !== 'flat'

  return (
    <article className="group">
      <Link
        href={`/watch/${video.slug}`}
        className="block focus-visible:outline-2 focus-visible:outline-accent rounded-lg"
      >
        <div className="relative aspect-video overflow-hidden rounded-lg bg-surface">
          <VideoThumb
            thumbnailUrl={video.thumbnailUrl}
            previewUrl={video.previewUrl}
            alt=""
            priority={priority}
            // Matches the grid breakpoints below, so the browser does not
            // download a 1280px thumbnail to paint it at 300px on mobile.
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, (max-width: 1536px) 25vw, 16vw"
          />

          <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1.5 py-0.5 text-xs font-medium tabular-nums text-white">
            {formatDuration(video.durationSeconds)}
          </span>

          {immersive && (
            <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-contrast">
              <Glasses size={11} aria-hidden />
              {video.projection.startsWith('eq180') ? '180°' : '360°'}
            </span>
          )}
        </div>

        <h3 className="mt-2 line-clamp-2 text-sm font-medium leading-snug text-foreground group-hover:text-accent">
          {video.title}
        </h3>
      </Link>

      <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-muted">
        <span className="inline-flex items-center gap-1">
          <Eye size={12} aria-hidden />
          {formatCount(video.viewCount)}
        </span>

        {rating !== null && (
          <span className="inline-flex items-center gap-1">
            <ThumbsUp size={12} aria-hidden />
            {rating}%
          </span>
        )}

        {video.publishedAt && <span>{formatRelativeTime(video.publishedAt)}</span>}
      </div>

      {/* Attribution line. The source network is what a viewer actually cares
          about and what the rightsholder expects to see credited, so it wins.
          The uploader is only shown when there is no network on the video —
          otherwise the credit would read as if our member produced it. */}
      {video.paysite ? (
        <Link
          href={`/paysite/${video.paysite.domain}`}
          className="mt-0.5 block truncate text-xs font-medium text-muted hover:text-accent"
        >
          {video.paysite.name}
        </Link>
      ) : (
        video.uploader && (
          <Link
            href={`/u/${video.uploader.username}`}
            className="mt-0.5 block truncate text-xs text-muted hover:text-accent"
          >
            {video.uploader.displayName ?? video.uploader.username}
          </Link>
        )
      )}
    </article>
  )
}

/** Responsive grid wrapper, so every listing page lays out identically. */
export function VideoGrid({
  videos,
  emptyMessage = 'No videos found.',
}: {
  videos: VideoCardData[]
  emptyMessage?: string
}) {
  if (videos.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-muted">{emptyMessage}</p>
    )
  }

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
      {videos.map((video, index) => (
        <VideoCard key={video.id} video={video} priority={index < 6} />
      ))}
    </div>
  )
}
