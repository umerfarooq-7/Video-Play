'use client'

import { useEffect, useState } from 'react'
import { Image as ImageIcon, Loader2 } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { STRIP_FRAMES, type VideoFrames } from '@/lib/studio/use-video-frames'

/**
 * Choose which moment of the video becomes its cover image.
 *
 * Only the timestamp is sent. The provider is asked to cut its own thumbnail
 * at that point during encoding, so the cover is a full-resolution still from
 * the finished video rather than the small canvas grab shown here — this
 * preview only has to be good enough to choose by.
 */
export function CoverPicker({
  frames,
  duration,
  scanning,
  captureAt,
}: Pick<VideoFrames, 'frames' | 'duration' | 'scanning' | 'captureAt'>) {
  // null means untouched, so the default below is a derivation rather than an
  // effect that writes state.
  const [chosen, setChosen] = useState<number | null>(null)
  const [shot, setShot] = useState<{ time: number; url: string } | null>(null)

  // Default to the middle of the video. The opening seconds are usually a
  // title card or a black frame, which makes a poor cover.
  const middle = frames.length >= STRIP_FRAMES ? frames[Math.floor(frames.length / 2)] : null
  const time = chosen ?? middle?.time ?? null

  // Show the sharper capture once it lands; until then the strip frame for
  // this moment stands in, so clicking never looks like it did nothing.
  const stripFrame = time === null ? null : frames.find((f) => Math.abs(f.time - time) < 0.05)
  const preview = (shot?.time === time ? shot.url : null) ?? stripFrame?.dataUrl ?? null
  const refining = time !== null && shot?.time !== time

  // Take a larger still of whatever moment is chosen. Debounced because
  // dragging the slider would otherwise queue a seek per pixel.
  useEffect(() => {
    if (time === null || scanning) return

    let cancelled = false
    const timer = setTimeout(() => {
      void captureAt(time, 480).then((url) => {
        if (!cancelled && url) setShot({ time, url })
      })
    }, 150)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [time, scanning, captureAt])

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <ImageIcon size={13} aria-hidden />
          Choose the cover
        </p>
        {time !== null && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            {refining && <Loader2 size={11} className="animate-spin" aria-hidden />}
            at {formatDuration(time)}
          </span>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        This is the still that represents the video everywhere on the site. Tap
        a moment below, or drag the slider to land on an exact frame.
      </p>

      <div className="relative aspect-video w-full max-w-sm overflow-hidden rounded border border-border bg-surface">
        {preview ? (
          // A canvas data URL: next/image has nothing to optimise and cannot
          // cache a data URI anyway.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="Chosen cover" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            {scanning ? 'Reading frames…' : 'Pick a moment'}
          </div>
        )}
      </div>

      {duration > 0 && (
        <label className="block space-y-1">
          <span className="sr-only">Cover position</span>
          <input
            type="range"
            min={0}
            max={duration}
            step={0.1}
            value={time ?? 0}
            disabled={scanning}
            onChange={(event) => setChosen(Number(event.target.value))}
            className="w-full max-w-sm accent-accent disabled:opacity-40"
          />
        </label>
      )}

      {frames.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {frames.map((frame) => {
            const isPicked = time !== null && Math.abs(frame.time - time) < 0.05

            return (
              <button
                key={frame.time}
                type="button"
                onClick={() => setChosen(frame.time)}
                aria-pressed={isPicked}
                title={`Use the frame at ${formatDuration(frame.time)}`}
                className={`relative overflow-hidden rounded border-2 transition-all ${
                  isPicked
                    ? 'border-accent ring-2 ring-accent/30'
                    : 'border-transparent hover:border-muted'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frame.dataUrl}
                  alt={`Frame at ${formatDuration(frame.time)}`}
                  className="aspect-video w-full object-cover"
                />
                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[9px] tabular-nums text-white">
                  {formatDuration(frame.time)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Submitted with the form. Empty means "let the provider choose". */}
      <input
        type="hidden"
        name="thumbnailTimeSeconds"
        value={time === null ? '' : time.toFixed(2)}
      />
    </div>
  )
}
