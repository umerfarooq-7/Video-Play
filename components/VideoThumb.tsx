'use client'

import { useState } from 'react'
import Image from 'next/image'
import { isRemoteAsset } from '@/lib/format'

/**
 * Grid thumbnail that swaps to an animated preview while hovered.
 *
 * The preview is only fetched once the pointer actually lands on the card. A
 * grid of 24 cards each eagerly loading a ~600KB animation would be a
 * multi-megabyte page, so `loaded` gates the request rather than just hiding
 * an already-downloaded image.
 *
 * Touch devices get nothing: there is no hover, and firing previews on scroll
 * would burn a phone's data allowance for no benefit.
 */
export function VideoThumb({
  thumbnailUrl,
  previewUrl,
  alt,
  priority = false,
  sizes,
}: {
  thumbnailUrl: string | null
  previewUrl: string | null
  alt: string
  priority?: boolean
  sizes: string
}) {
  const [hovered, setHovered] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const showPreview = hovered && !!previewUrl

  return (
    <div
      className="absolute inset-0"
      onPointerEnter={(event) => {
        // Skip touch: a tap should navigate, not start a preview.
        if (event.pointerType === 'touch') return
        setHovered(true)
        setLoaded(true)
      }}
      onPointerLeave={() => setHovered(false)}
    >
      {thumbnailUrl ? (
        <Image
          src={thumbnailUrl}
          alt={alt}
          fill
          priority={priority}
          unoptimized={isRemoteAsset(thumbnailUrl)}
          sizes={sizes}
          className={`object-cover transition-opacity duration-200 ${
            showPreview ? 'opacity-0' : 'opacity-100'
          }`}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-xs text-muted">
          Processing…
        </div>
      )}

      {loaded && previewUrl && (
        // A plain <img>: this is an animated WebP, and running it through the
        // image optimizer would strip the animation and produce a still frame.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={previewUrl}
          alt=""
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            showPreview ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}
    </div>
  )
}
