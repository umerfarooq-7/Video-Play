'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { VideoGrid } from '@/components/VideoCard'
import { loadMoreVideos } from '@/lib/browse/actions'
import type { VideoCardData } from '@/lib/queries'

/**
 * A grid that keeps loading the next page as it is scrolled.
 *
 * The first page is rendered on the server, so the grid is complete before any
 * JavaScript runs and a crawler sees real content. Everything after it is
 * fetched as the end of the list comes into view.
 *
 * The button underneath is not a fallback that only appears when something
 * fails — it is always there, because IntersectionObserver never fires for
 * someone navigating by keyboard, and because a stalled request otherwise
 * leaves nothing to retry with.
 */
export function InfiniteVideoGrid({
  initial,
  total,
  perPage,
  sort,
  emptyMessage,
}: {
  initial: VideoCardData[]
  total: number
  perPage: number
  sort: 'new' | 'views' | 'rating' | 'duration'
  emptyMessage?: string
}) {
  const [videos, setVideos] = useState(initial)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exhausted, setExhausted] = useState(initial.length >= total)

  const sentinelRef = useRef<HTMLDivElement>(null)

  // Rebuilt whenever the page or the in-flight state changes, which is also
  // what re-arms the observer below. A callback captured once would keep
  // asking for page 2 forever.
  const loadNext = useCallback(async () => {
    if (loading || exhausted) return

    setLoading(true)
    setError(null)
    const next = page + 1

    try {
      const result = await loadMoreVideos({ page: next, perPage, sort })

      setVideos((current) => {
        // New uploads shift every later page along, so the same video can
        // arrive twice. Keeping the first copy also keeps React's keys unique.
        const seen = new Set(current.map((video) => video.id))
        return [...current, ...result.videos.filter((video) => !seen.has(video.id))]
      })
      setPage(next)
      if (!result.hasMore || result.videos.length === 0) setExhausted(true)
    } catch {
      setError('Could not load more videos.')
    } finally {
      setLoading(false)
    }
  }, [loading, exhausted, page, perPage, sort])

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        // Start early: by the time the end of the list is actually on screen,
        // the reader is already waiting.
        if (entries.some((entry) => entry.isIntersecting)) void loadNext()
      },
      { rootMargin: '600px' },
    )

    observer.observe(sentinel)

    // A plain scroll check alongside the observer. IntersectionObserver runs
    // off the browser's rendering steps, which stop while a tab is in the
    // background or the window is hidden, and it can then miss the moment the
    // end of the list comes into view. Measuring on scroll costs one
    // getBoundingClientRect and never misses.
    let lastCheck = 0
    const onScroll = () => {
      const stamp = Date.now()
      if (stamp - lastCheck < 150) return
      lastCheck = stamp
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 600) {
        void loadNext()
      }
    }

    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll, { passive: true })

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [loadNext])

  return (
    <div>
      <VideoGrid videos={videos} emptyMessage={emptyMessage} />

      {/* Announce growth for screen readers, which have no scroll position to
          tell them anything happened. */}
      <p aria-live="polite" className="sr-only">
        Showing {videos.length} of {total} videos
      </p>

      {videos.length > 0 && (
        <div ref={sentinelRef} className="flex flex-col items-center gap-2 py-6">
          {exhausted ? (
            <p className="text-xs text-muted">
              That is all {total} video{total === 1 ? '' : 's'}.
            </p>
          ) : (
            <>
              {error && <p className="text-xs text-danger">{error}</p>}
              <button
                type="button"
                onClick={() => void loadNext()}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-xs font-semibold hover:border-accent hover:text-accent disabled:opacity-60"
              >
                {loading && <Loader2 size={13} className="animate-spin" aria-hidden />}
                {loading ? 'Loading…' : error ? 'Try again' : 'Load more videos'}
              </button>
              <p className="text-[11px] text-muted">
                {videos.length} of {total}
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
