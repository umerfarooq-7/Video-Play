/** Presentation helpers shared by the grid, watch page and dashboards. */

/**
 * Is this asset served from another origin?
 *
 * Used to decide whether an image may go through Next's optimizer. It must not
 * when the CDN enforces hotlink protection: the optimizer fetches server-side
 * and sends no Referer, so the CDN returns 403 and the thumbnail silently
 * breaks. Letting the browser load it directly works, because the browser does
 * send a Referer. Local media (a /media path) is same-origin and optimizes
 * fine.
 */
export function isRemoteAsset(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//.test(url)
}

/** 3725 -> "1:02:05", 125 -> "2:05". Null duration renders as an em dash. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'

  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60

  const pad = (n: number) => n.toString().padStart(2, '0')

  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(secs)}`
    : `${minutes}:${pad(secs)}`
}

/** 1_240_000 -> "1.2M". Keeps grid captions to a fixed width. */
export function formatCount(value: number | null | undefined): string {
  const n = value ?? 0
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`
  return `${(n / 1_000_000_000).toFixed(1)}B`
}

/** Coarse relative time. Deliberately not live-updating. */
export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return ''

  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''

  const seconds = Math.floor((Date.now() - then) / 1000)

  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** Like ratio as a percentage, or null when nobody has voted. */
export function ratingPercent(likes: number, dislikes: number): number | null {
  const total = likes + dislikes
  if (total === 0) return null
  return Math.round((likes / total) * 100)
}

/**
 * URL-safe slug. Trailing/leading dashes are stripped so the result always
 * satisfies the `^[a-z0-9]+(-[a-z0-9]+)*$` CHECK constraint on videos.slug.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '')
}
