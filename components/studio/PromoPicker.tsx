'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Images, Scissors } from 'lucide-react'
import { formatDuration } from '@/lib/format'

/** Frames shown across the video so the uploader can see what is in it. */
const STRIP_FRAMES = 10

/** Default promo length, and the ceiling the database CHECK enforces. */
const DEFAULT_PROMO_SECONDS = 10
const MAX_PROMO_SECONDS = 30

interface Frame {
  time: number
  dataUrl: string
}

export interface PromoWindow {
  startSeconds: number
  endSeconds: number
  /** Frame at the start of the window, for the parent to show as a poster. */
  posterDataUrl: string | null
}

/**
 * Pick the promo segment from a file that has not been uploaded yet.
 *
 * Everything here happens in the browser against the local file: an object URL
 * feeds a <video>, and frames are drawn onto a canvas. No upload, no server, no
 * CORS — and seeking is instant because the bytes are already on the machine.
 *
 * That ordering is the point. Previously the video had to be uploaded and
 * encoded before a promo could be cut, which meant waiting through a transcode
 * before finding out the interesting part was somewhere else entirely.
 */
export function PromoPicker({
  file,
  onChange,
}: {
  file: File
  onChange: (window: PromoWindow | null) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [duration, setDuration] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [scanning, setScanning] = useState(false)
  const [start, setStart] = useState(0)
  const [poster, setPoster] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const end = Math.min(start + DEFAULT_PROMO_SECONDS, duration || DEFAULT_PROMO_SECONDS)

  // Attach the local file. revokeObjectURL matters: without it the browser
  // holds the whole file in memory until the tab closes.
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
        // browsers; capturing immediately yields the previous frame.
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

  /** Walk the file and grab evenly spaced frames. */
  const buildStrip = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.duration || !Number.isFinite(video.duration)) return

    setScanning(true)
    const collected: Frame[] = []

    try {
      for (let i = 0; i < STRIP_FRAMES; i++) {
        // Half-step offset: the first frame of a video is very often black.
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

  /** Refresh the poster and tell the parent which window is selected. */
  const commit = useCallback(
    async (nextStart: number) => {
      const video = videoRef.current
      if (!video || !duration) return

      const clamped = Math.max(0, Math.min(nextStart, Math.max(0, duration - 1)))
      await seekAndSettle(video, clamped)
      const shot = capture(320)

      setPoster(shot)
      onChange({
        startSeconds: Number(clamped.toFixed(2)),
        endSeconds: Number(
          Math.min(clamped + DEFAULT_PROMO_SECONDS, duration).toFixed(2),
        ),
        posterDataUrl: shot,
      })
    },
    [duration, seekAndSettle, capture, onChange],
  )

  // Select an opening window as soon as the strip is ready, so a user who
  // changes nothing still gets a sensible promo instead of none.
  useEffect(() => {
    if (duration > 0 && frames.length === STRIP_FRAMES && poster === null) {
      void commit(start)
    }
  }, [duration, frames.length, poster, start, commit])

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
              {formatDuration(duration)} total
            </span>
          )
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <p className="text-[11px] leading-relaxed text-muted">
        This is the {DEFAULT_PROMO_SECONDS}-second clip that plays when someone
        hovers your video in the grid. Click a scene below, or drag the slider,
        to choose where it starts.
      </p>

      {/* Scene strip */}
      {frames.length > 0 && (
        <div className="grid grid-cols-5 gap-1.5">
          {frames.map((frame) => {
            const inWindow = frame.time >= start && frame.time <= end
            return (
              <button
                key={frame.time}
                type="button"
                onClick={() => {
                  setStart(frame.time)
                  void commit(frame.time)
                }}
                title={`Start the promo at ${formatDuration(frame.time)}`}
                className={`relative overflow-hidden rounded border-2 transition-colors ${
                  inWindow ? 'border-accent' : 'border-transparent hover:border-muted'
                }`}
              >
                {/* Canvas data URLs: next/image would have nothing to optimise
                    and cannot cache a data URI anyway. */}
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

      {duration > 0 && (
        <>
          <div>
            <div className="flex items-baseline justify-between text-xs">
              <label htmlFor="promo-start" className="font-medium">
                Promo starts at
              </label>
              <span className="tabular-nums text-muted">
                {formatDuration(start)} – {formatDuration(end)}
              </span>
            </div>
            <input
              id="promo-start"
              type="range"
              min={0}
              max={Math.max(0, duration - 1)}
              step={0.5}
              value={start}
              onChange={(e) => setStart(Number(e.target.value))}
              onPointerUp={() => void commit(start)}
              onKeyUp={() => void commit(start)}
              className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-raised accent-[var(--accent)]"
            />
          </div>

          {/* The exact opening frame, larger. It becomes the first thing a
              viewer sees on hover, so it is worth showing properly. */}
          {poster && (
            <div className="flex items-center gap-3">
              <div className="w-32 shrink-0 overflow-hidden rounded border border-border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={poster} alt="" className="aspect-video w-full object-cover" />
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted">
                <Images size={12} aria-hidden />
                Your promo opens on this frame.
              </p>
            </div>
          )}
        </>
      )}

      {/* Submitted with the form. */}
      <input type="hidden" name="previewStartSeconds" value={start.toFixed(2)} />
      <input type="hidden" name="previewEndSeconds" value={end.toFixed(2)} />
    </div>
  )
}

export { MAX_PROMO_SECONDS, DEFAULT_PROMO_SECONDS }
