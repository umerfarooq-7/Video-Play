import { DEFAULT_DOWNLOAD_TEXT } from '@/lib/constants'

export interface NetworkPromoSettings {
  promo_url: string | null
  offer_text: string | null
  download_text: string | null
}

// Paid outbound links: `sponsored` tells search engines so, and `noopener`
// stops the network's page from reaching back into this tab.
const OUTBOUND = { target: '_blank', rel: 'sponsored nofollow noopener noreferrer' } as const

/**
 * The link is stored behind an http(s) CHECK, but it is rendered into an href
 * on a public page, so check again rather than trust the column.
 */
function safeUrl(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null
}

/** "39min 26sec", "1h 12min" — the wording viewers see on network sites. */
function spokenDuration(seconds: number): string {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`
  if (m > 0) return s > 0 ? `${m}min ${s}sec` : `${m}min`
  return `${s}sec`
}

/** Offer bar above the player. Needs both a link and some text to say. */
export function NetworkOfferBar({ network }: { network: NetworkPromoSettings }) {
  const url = safeUrl(network.promo_url)
  const text = network.offer_text?.trim()
  if (!url || !text) return null

  return (
    <a
      href={url}
      {...OUTBOUND}
      className="flex items-center justify-between gap-3 rounded-lg bg-green-700 px-3 py-2 text-sm text-white hover:bg-green-800"
    >
      <span className="min-w-0">{text}</span>
      <span className="shrink-0 font-bold underline underline-offset-2">Join now</span>
    </a>
  )
}

/** "Download the full movie" link beneath the player. */
export function NetworkDownloadLink({
  network,
  fullDurationSeconds,
}: {
  network: NetworkPromoSettings
  fullDurationSeconds: number | null
}) {
  const url = safeUrl(network.promo_url)
  if (!url) return null

  const template = network.download_text?.trim() || DEFAULT_DOWNLOAD_TEXT
  const duration = fullDurationSeconds ? spokenDuration(fullDurationSeconds) : ''
  // Without a recorded length the token just drops out, and the doubled space
  // it would leave is collapsed.
  const text = template.replaceAll('{duration}', duration).replace(/\s{2,}/g, ' ').trim()

  return (
    <p className="text-center">
      <a
        href={url}
        {...OUTBOUND}
        className="text-base font-bold text-accent underline underline-offset-2 hover:text-accent-hover"
      >
        {text}
      </a>
    </p>
  )
}
