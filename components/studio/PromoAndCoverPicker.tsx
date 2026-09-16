'use client'

import { useState } from 'react'
import { useVideoFrames } from '@/lib/studio/use-video-frames'
import type { Scene } from '@/lib/studio/cut-scenes'
import { ScenePicker } from './ScenePicker'
import { CoverPicker } from './CoverPicker'

/**
 * Scan the chosen file once, then let the uploader pick the promo scenes and
 * the cover from it.
 *
 * The scan owns a hidden <video> and <canvas>, which is why it lives here
 * rather than in either picker: decoding a multi-gigabyte file twice would
 * double the wait for nothing. The scenes live here too, because the cover
 * has to come from inside them — anything else is cut away before upload.
 */
export function PromoAndCoverPicker({ file }: { file: File }) {
  const { videoRef, canvasRef, onLoadedMetadata, frames, duration, scanning, error, captureAt } =
    useVideoFrames(file)
  const [scenes, setScenes] = useState<Scene[]>([])

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

      <ScenePicker
        file={file}
        frames={frames}
        duration={duration}
        scanning={scanning}
        error={error}
        captureAt={captureAt}
        scenes={scenes}
        onScenesChange={setScenes}
      />

      <CoverPicker
        frames={frames}
        duration={duration}
        scanning={scanning}
        captureAt={captureAt}
        scenes={scenes}
      />
    </div>
  )
}
