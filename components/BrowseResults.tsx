import Link from 'next/link'
import { VideoGrid } from '@/components/VideoCard'
import type { VideoCardData } from '@/lib/queries'

/**
 * Shared body for the model / paysite / tag browse pages.
 *
 * All three are the same page with a different heading, so the grid, empty
 * state and pagination live here rather than being copied three times and
 * drifting apart.
 */
export function BrowseResults({
  videos,
  total,
  page,
  perPage,
  basePath,
  emptyMessage,
}: {
  videos: VideoCardData[]
  total: number
  page: number
  perPage: number
  /** Path to build pagination links from, e.g. `/model/jane-doe`. */
  basePath: string
  emptyMessage: string
}) {
  const totalPages = Math.max(1, Math.ceil(total / perPage))

  return (
    <>
      <VideoGrid videos={videos} emptyMessage={emptyMessage} />

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 pt-4"
        >
          {page > 1 && (
            <Link
              href={`${basePath}?page=${page - 1}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
            >
              Previous
            </Link>
          )}
          <span className="text-xs text-muted">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link
              href={`${basePath}?page=${page + 1}`}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </>
  )
}

/** Circular avatar / logo with a letter fallback when no image is set. */
export function EntityAvatar({
  src,
  name,
  size = 'md',
}: {
  src: string | null
  name: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
}) {
  const dimension = {
    xs: 'size-7',
    sm: 'size-12',
    md: 'size-16',
    lg: 'size-20',
  }[size]
  const text = {
    xs: 'text-[10px]',
    sm: 'text-base',
    md: 'text-xl',
    lg: 'text-2xl',
  }[size]

  if (src) {
    return (
      // Admin-supplied URLs point at arbitrary hosts, which the Next image
      // optimizer would refuse unless every one were allowlisted. A plain img
      // keeps adding a new paysite a data entry task, not a redeploy.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt=""
        className={`${dimension} shrink-0 rounded-full object-cover`}
      />
    )
  }

  return (
    <span
      aria-hidden
      className={`${dimension} ${text} grid shrink-0 place-items-center rounded-full bg-surface-raised font-bold uppercase`}
    >
      {name.charAt(0)}
    </span>
  )
}
