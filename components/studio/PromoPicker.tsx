'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Scissors, Check } from 'lucide-react'
import { formatDuration } from '@/lib/format'

/** Frames offered across the video. */
const STRIP_FRAMES = 10

/** How long each chosen scene contributes to the promo. */
const SEGMENT_SECONDS = 3

/** Ceilings mirrored by the preview_segments_shape CHECK. */
const MAX_SEGMENTS = 10
const MAX_TOTAL_SECONDS = 30

interface Frame {
  time: number
  dataUrl: string
}

export interface PromoSelection {
  segments: { start: number; end: number }[]
  posterDataUrl: string | null
}

/**
 * Pick the promo from a file that has not been uploaded yet.
 *
 * Everything runs in the browser against the local file: an object URL feeds a
 * hidden <video> and frames are drawn onto a canvas. No upload, no server, no
 * CORS, and seeking is instant because the bytes are already on the machine.
 *
 * Several scenes can be chosen and are stitched into one preview. A single
 * continuous window only ever shows one moment of a video; a few short cuts
 * convey the whole thing in the same few seconds.
 */
export function PromoPicker({
  file,
  onChange,
}: {
  file: File
  onChange: (selection: PromoSelection | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [duration, setDuration] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [scanning, setScanning] = useState(false)
  const [picked, setPicked] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)

  const segments = picked
    .slice()
    .sort((a, b) => a - b)
    .map((start) => ({
      start: Number(start.toFixed(2)),
      end: Number(Math.min(start + SEGMENT_SECONDS, duration || start + SEGMENT_SECONDS).toFixed(2)),
    }))

  const totalSeconds = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
  const atLimit = picked.length >= MAX_SEGMENTS || totalSeconds >= MAX_TOTAL_SECONDS

  // revokeObjectURL matters: without it the browser pins the whole file in
  // memory until the tab closes.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const url = URL.createObjectURL(file)
    video.src = url

    return () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  const seekAndSettle = useCallback((video: HTMLVideoElement, time: number) => {
    return new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        // 'seeked' fires before the new frame is reliably painted in some
        // browsers, and capturing early yields the previous frame.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }
      video.addEventListener('seeked', done)
      video.currentTime = Math.max(0, Math.min(time, video.duration || 0))
    })
  }, [])

  const capture = useCallback((width = 240): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return null

    const height = Math.round((video.videoHeight / video.videoWidth) * width)
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(video, 0, 0, width, height)
    try {
      return canvas.toDataURL('image/jpeg', 0.6)
    } catch {
      return null
    }
  }, [])

  const buildStrip = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.duration || !Number.isFinite(video.duration)) return

    setScanning(true)
    const collected: Frame[] = []

    try {
      for (let i = 0; i < STRIP_FRAMES; i++) {
        // Half-step offset: the opening frame of a video is very often black.
        const time = ((i + 0.5) / STRIP_FRAMES) * video.duration
        await seekAndSettle(video, time)
        const dataUrl = capture()
        if (dataUrl) collected.push({ time, dataUrl })
        setFrames([...collected])
      }
    } finally {
      setScanning(false)
    }
  }, [capture, seekAndSettle])

  function onLoadedMetadata() {
    const video = videoRef.current
    if (!video) return

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setError('Could not read that file. Try a different format.')
      return
    }

    setDuration(video.duration)
    void buildStrip()
  }

  function toggle(time: number) {
    setPicked((prev) => {
      if (prev.includes(time)) return prev.filter((t) => t !== time)
      if (prev.length >= MAX_SEGMENTS) return prev
      if ((prev.length + 1) * SEGMENT_SECONDS > MAX_TOTAL_SECONDS) return prev
      return [...prev, time]
    })
  }

  // Default to the first scene so a user who changes nothing still gets a
  // sensible promo rather than none at all.
  useEffect(() => {
    if (frames.length === STRIP_FRAMES && picked.length === 0) {
      setPicked([frames[0].time])
    }
  }, [frames, picked.length])

  // Report upward whenever the selection changes. The poster is the frame the
  // promo opens on, which is the first thing a viewer sees on hover.
  useEffect(() => {
    if (segments.length === 0) {
      onChange(null)
      return
    }
    const first = frames.find((f) => f.time === segments[0].start)
    onChange({ segments, posterDataUrl: first?.dataUrl ?? null })
    // segments is derived from picked/duration; depending on those avoids an
    // identity-change loop on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, duration, frames])

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <canvas ref={canvasRef} className="hidden" aria-hidden />
      <video
        ref={videoRef}
        preload="metadata"
        muted
        playsInline
        onLoadedMetadata={onLoadedMetadata}
        className="hidden"
      />

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
