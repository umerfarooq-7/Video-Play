import Link from 'next/link'
import { headers } from 'next/headers'
import { listVideos, type SortOption } from '@/lib/queries'
import { VideoGrid } from '@/components/VideoCard'
import { COUNTRY_HEADER } from '@/lib/constants'
import type { VideoProjection } from '@/types/database'

export async function generateMetadata({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams
  const q = typeof params.q === 'string' ? params.q : ''
  return {
    title: q ? `"${q}"` : 'Browse',
    // Search result pages are thin and near-duplicate; keeping them out of the
    // index avoids diluting the category and watch pages that should rank.
    robots: { index: false, follow: true },
  }
}

const SORTS: { value: SortOption; label: string }[] = [
  { value: 'new', label: 'Newest' },
  { value: 'views', label: 'Most viewed' },
  { value: 'rating', label: 'Top rated' },
  { value: 'duration', label: 'Longest' },
]

const DURATIONS = [
  { value: '', label: 'Any length' },
  { value: 'short', label: 'Under 5 min' },
  { value: 'medium', label: '5–20 min' },
  { value: 'long', label: 'Over 20 min' },
]

export default async function SearchPage({ searchParams }: PageProps<'/search'>) {
  const params = await searchParams

  const q = typeof params.q === 'string' ? params.q.trim() : ''
  const page = Number(params.page) > 0 ? Number(params.page) : 1

  const sortParam = typeof params.sort === 'string' ? params.sort : ''
  const sort: SortOption = SORTS.some((s) => s.value === sortParam)
    ? (sortParam as SortOption)
    : q
      ? 'relevance'
      : 'new'

  const durationParam = typeof params.duration === 'string' ? params.duration : ''
  const { minDurationSeconds, maxDurationSeconds } = durationRange(durationParam)

  const projectionParam =
    typeof params.projection === 'string' ? params.projection : ''
  const projection =
    projectionParam === 'immersive'
      ? ('immersive' as const)
      : isProjection(projectionParam)
        ? projectionParam
        : undefined

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  const perPage = 24
  const { videos, total } = await listVideos({
    search: q || undefined,
    sort,
    page,
    perPage,
    country,
    minDurationSeconds,
    maxDurationSeconds,
    projection,
  })

  const totalPages = Math.max(1, Math.ceil(total / perPage))

  /** Rebuild the querystring, preserving filters and resetting to page 1. */
  const buildHref = (overrides: Record<string, string>) => {
    const next = new URLSearchParams()
    if (q) next.set('q', q)
    if (sortParam) next.set('sort', sortParam)
    if (durationParam) next.set('duration', durationParam)
    if (projectionParam) next.set('projection', projectionParam)
    for (const [key, value] of Object.entries(overrides)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    return `/search?${next.toString()}`
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">
          {q ? `Results for "${q}"` : 'Browse videos'}
        </h1>
        <p className="mt-0.5 text-xs text-muted">
          {total} video{total === 1 ? '' : 's'}
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <FilterRow label="Sort">
          {SORTS.map((option) => (
            <FilterChip
              key={option.value}
              href={buildHref({ sort: option.value, page: '' })}
              active={sort === option.value}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Length">
          {DURATIONS.map((option) => (
            <FilterChip
              key={option.value || 'any'}
              href={buildHref({ duration: option.value, page: '' })}
              active={durationParam === option.value}
            >
              {option.label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Type">
          <FilterChip
            href={buildHref({ projection: '', page: '' })}
            active={!projectionParam}
          >
            All
          </FilterChip>
          <FilterChip
            href={buildHref({ projection: 'immersive', page: '' })}
            active={projectionParam === 'immersive'}
          >
            VR &amp; 360
          </FilterChip>
          <FilterChip
            href={buildHref({ projection: 'flat', page: '' })}
            active={projectionParam === 'flat'}
          >
            Standard
          </FilterChip>
        </FilterRow>
      </div>

      <VideoGrid
        videos={videos}
        emptyMessage={
          q
            ? `Nothing matched "${q}". Try fewer or different words.`
            : 'No videos published yet.'
        }
      />

      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 pt-2"
        >
          {page > 1 && (
            <Link
              href={buildHref({ page: String(page - 1) })}
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
              href={buildHref({ page: String(page + 1) })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface"
            >
              Next
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}

function FilterRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-muted">
        {label}
      </p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        active
          ? 'bg-accent text-accent-contrast'
          : 'border border-border text-muted hover:text-foreground'
      }`}
    >
      {children}
    </Link>
  )
}

function durationRange(value: string): {
  minDurationSeconds?: number
  maxDurationSeconds?: number
} {
  switch (value) {
    case 'short':
      return { maxDurationSeconds: 300 }
    case 'medium':
      return { minDurationSeconds: 300, maxDurationSeconds: 1200 }
    case 'long':
      return { minDurationSeconds: 1200 }
    default:
      return {}
  }
}

function isProjection(value: string): value is VideoProjection {
  return [
    'flat',
    'eq360_mono',
    'eq360_stereo_tb',
    'eq180_mono',
    'eq180_stereo_sbs',
  ].includes(value)
}
