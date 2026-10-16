import type { AdCreative } from '@/lib/ads/queries'

/**
 * One banner.
 *
 * Two kinds end up here. An image the admin uploaded somewhere and linked is
 * rendered as a plain <img> inside an <a>; that path is ours end to end.
 *
 * A snippet from an ad network is not: it is third-party JavaScript that we
 * are asked to run on a page where visitors are signed in. Dropped straight
 * into the document it could read the session cookie, rewrite the player, or
 * follow a viewer around the site. It therefore runs inside an iframe WITHOUT
 * `allow-same-origin`, which gives it an opaque origin of its own — no access
 * to our DOM, our cookies or our storage. `allow-popups` and
 * `allow-popups-to-escape-sandbox` are the two it genuinely needs, because an
 * ad that cannot open its landing page earns nothing.
 */
export function AdSlot({ ad, className = '' }: { ad: AdCreative; className?: string }) {
  if (ad.kind === 'html' && ad.htmlCode) {
    return (
      <iframe
        title="Advertisement"
        srcDoc={frameDocument(ad.htmlCode)}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
        referrerPolicy="no-referrer"
        loading="lazy"
        width={ad.width ?? undefined}
        height={ad.height ?? 250}
        className={`mx-auto block max-w-full border-0 ${className}`}
      />
    )
  }

  // A short clip standing in for an animated GIF. Muted and looping, with no
  // controls, so it reads as a banner rather than something to play — and at
  // a fraction of a GIF's size for the same few seconds of motion.
  if (ad.kind === 'video' && ad.videoUrl) {
    const clip = (
      <video
        src={ad.videoUrl}
        width={ad.width ?? undefined}
        height={ad.height ?? undefined}
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        // Not just decoration: a banner that pauses out of view costs the
        // viewer nothing and saves the bandwidth.
        className="mx-auto block h-auto max-w-full"
      />
    )

    return wrapClick(ad, clip, className)
  }

  if (ad.kind !== 'image' || !ad.imageUrl) return null

  const image = (
    // An admin-supplied URL on an arbitrary host: the Next image optimizer
    // would refuse it unless every ad network were allowlisted in advance.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={ad.imageUrl}
      alt="Advertisement"
      width={ad.width ?? undefined}
      height={ad.height ?? undefined}
      loading="lazy"
      className="mx-auto block h-auto max-w-full"
    />
  )

  return wrapClick(ad, image, className)
}

/** Make a creative clickable, when the ad has somewhere to send the viewer. */
function wrapClick(ad: AdCreative, creative: React.ReactNode, className: string) {
  if (!ad.clickable) {
    return <div className={className}>{creative}</div>
  }

  return (
    <a
      href={`/api/ads/${ad.id}/click`}
      target="_blank"
      // `sponsored` is what the link actually is, and the rest keeps the
      // destination from inheriting our referrer or reaching window.opener.
      rel="sponsored nofollow noopener noreferrer"
      className={`block ${className}`}
    >
      {creative}
    </a>
  )
}

/**
 * Wrap the snippet in a minimal document.
 *
 * Without the reset the frame arrives with the user agent's default 8px body
 * margin, which shows as a grey border around every network banner.
 */
function frameDocument(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>html,body{margin:0;padding:0;overflow:hidden;background:transparent}</style></head><body>${html}</body></html>`
}

/**
 * A labelled banner on its own row.
 *
 * The label is not decoration: presenting paid placement as if it were part of
 * the site is what advertising regulators object to, and it costs one line.
 */
export function AdBanner({ ad, className = '' }: { ad: AdCreative; className?: string }) {
  return (
    <aside
      aria-label="Advertisement"
      className={`flex flex-col items-center gap-1 py-2 ${className}`}
    >
      <span className="text-[10px] uppercase tracking-wider text-muted">Advertisement</span>
      <AdSlot ad={ad} />
    </aside>
  )
}
