'use client'

import { useState } from 'react'
import { Loader2, Scissors, Check } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { STRIP_FRAMES, type VideoFrames } from '@/lib/studio/use-video-frames'

/** How long each chosen scene contributes to the promo. */
const SEGMENT_SECONDS = 3

/** Ceilings mirrored by the preview_segments_shape CHECK. */
const MAX_SEGMENTS = 10
const MAX_TOTAL_SECONDS = 30

/**
 * Pick the promo from a file that has not been uploaded yet.
 *
 * Several scenes can be chosen and are stitched into one preview. A single
 * continuous window only ever shows one moment of a video; a few short cuts
 * convey the whole thing in the same few seconds.
 *
 * The frames come from {@link useVideoFrames}, which the upload form owns so
 * that this and the cover picker share a single scan of the file.
 */
export function PromoPicker({
  frames,
  duration,
  scanning,
  error,
}: Pick<VideoFrames, 'frames' | 'duration' | 'scanning' | 'error'>) {
  // null means the uploader has not touched the strip yet, which lets the
  // default below stay a derivation instead of an effect that writes state.
  const [chosen, setChosen] = useState<number[] | null>(null)

  // Default to the first scene so someone who changes nothing still gets a
  // promo rather than none at all.
  const fallback = frames.length === STRIP_FRAMES ? [frames[0].time] : []
  const picked = chosen ?? fallback

  const segments = picked
    .slice()
    .sort((a, b) => a - b)
    .map((start) => ({
      start: Number(start.toFixed(2)),
      end: Number(Math.min(start + SEGMENT_SECONDS, duration || start + SEGMENT_SECONDS).toFixed(2)),
    }))

  const totalSeconds = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
  const atLimit = picked.length >= MAX_SEGMENTS || totalSeconds >= MAX_TOTAL_SECONDS

  function toggle(time: number) {
    // Update from the previous value rather than from `picked` in this
    // render's closure: two clicks landing in one batch would otherwise both
    // build on the same stale list and the first would be lost.
    setChosen((prev) => {
      const current = prev ?? fallback
      if (current.includes(time)) return current.filter((t) => t !== time)
      if (current.length >= MAX_SEGMENTS) return current
      if ((current.length + 1) * SEGMENT_SECONDS > MAX_TOTAL_SECONDS) return current
      return [...current, time]
    })
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Scissors size={13} aria-hidden />
          Choose the promo
        </p>
        {scanning ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={11} className="animate-spin" aria-hidden />
            Reading frames… {frames.length}/{STRIP_FRAMES}
          </span>
        ) : (
          duration > 0 && (
            <span className="text-xs text-muted">
              {segments.length} scene{segments.length === 1 ? '' : 's'} ·{' '}
              {totalSeconds.toFixed(0)}s promo
            </span>
          )
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <p className="text-[11px] leading-relaxed text-muted">
        Click as many scenes as you like — they are joined into the short clip
        that plays when someone hovers your video. {SEGMENT_SECONDS} seconds
        from each, up to {MAX_TOTAL_SECONDS} seconds total.
      </p>

      {frames.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {frames.map((frame) => {
            const isPicked = picked.includes(frame.time)
            const order = segments.findIndex((s) => s.start === Number(frame.time.toFixed(2)))
            const disabled = !isPicked && atLimit

            return (
              <button
                key={frame.time}
                type="button"
                onClick={() => toggle(frame.time)}
                disabled={disabled}
                aria-pressed={isPicked}
                title={
                  isPicked
                    ? `Remove the scene at ${formatDuration(frame.time)}`
                    : `Add the scene at ${formatDuration(frame.time)}`
                }
                className={`relative overflow-hidden rounded border-2 transition-all ${
                  isPicked
                    ? 'border-accent ring-2 ring-accent/30'
                    : disabled
                      ? 'cursor-not-allowed border-transparent opacity-40'
                      : 'border-transparent hover:border-muted'
                }`}
              >
                {/* Canvas data URLs: next/image has nothing to optimise here
                    and cannot cache a data URI anyway. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={frame.dataUrl}
                  alt={`Frame at ${formatDuration(frame.time)}`}
                  className="aspect-video w-full object-cover"
                />

                {isPicked && order >= 0 && (
                  // The number is the play order, not just a tick — with
                  // several scenes joined, which comes first is the thing you
                  // actually need to see.
                  <span className="absolute left-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-accent text-[9px] font-bold text-accent-contrast">
                    {order + 1}
                  </span>
                )}

                <span className="absolute bottom-0.5 right-0.5 rounded bg-black/80 px-1 text-[9px] tabular-nums text-white">
                  {formatDuration(frame.time)}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {atLimit && (
        <p className="flex items-center gap-1 text-[11px] text-accent">
          <Check size={11} aria-hidden />
          Maximum promo length reached. Unpick a scene to swap one in.
        </p>
      )}

      {/* Submitted with the form. */}
      <input type="hidden" name="previewSegments" value={JSON.stringify(segments)} />
      <input
        type="hidden"
        name="previewStartSeconds"
        value={segments[0]?.start ?? ''}
      />
      <input type="hidden" name="previewEndSeconds" value={segments[0]?.end ?? ''} />
    </div>
  )
}

export { SEGMENT_SECONDS, MAX_SEGMENTS, MAX_TOTAL_SECONDS }
