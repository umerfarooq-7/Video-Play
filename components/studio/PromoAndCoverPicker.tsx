'use client'

import { useVideoFrames } from '@/lib/studio/use-video-frames'
import { PromoPicker } from './PromoPicker'
import { CoverPicker } from './CoverPicker'

/**
 * Scan the chosen file once, then let the uploader pick both the promo and the
 * cover from the same stills.
 *
 * The scan owns the hidden <video> and <canvas>, which is why it lives here
 * rather than in either picker: decoding a multi-gigabyte file twice, once per
 * picker, would double the wait for nothing.
 */
export function PromoAndCoverPicker({ file }: { file: File }) {
  const { videoRef, canvasRef, onLoadedMetadata, frames, duration, scanning, error, captureAt } =
    useVideoFrames(file)

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" aria-hidden />
      <video
        ref={videoRef}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={onLoadedMetadata}
        className="hidden"
      />

      <PromoPicker
        frames={frames}
        duration={duration}
        scanning={scanning}
        error={error}
      />

      <CoverPicker
        frames={frames}
        duration={duration}
        scanning={scanning}
        captureAt={captureAt}
      />
    </div>
  )
}
