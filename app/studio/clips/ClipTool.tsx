'use client'

import { useActionState, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Scissors, Loader2, Images } from 'lucide-react'
import { createClip, type StudioState } from '@/lib/studio/video-actions'
import { useHlsVideo } from '@/components/player/useHlsVideo'
import { CheckboxField, Field, FormMessage, SubmitButton } from '@/components/form'
import { formatDuration } from '@/lib/format'
import { MAX_CLIP_SECONDS } from '@/lib/constants'

interface Source {
  id: string
  title: string
  durationSeconds: number | null
  playbackUrl: string
  poster: string | null
}

/** How many thumbnails the scene strip shows. */
const STRIP_FRAMES = 12

interface Frame {
  time: number
  dataUrl: string
}

/**
 * Promo cutting tool.
 *
 * Two things the client specifically asked for drive this design:
 *
 *   1. You cut from a full-length source that is NOT published. The source
 *      exists only to be cut from; only the promo goes live.
 *   2. You need to SEE the scenes to choose a good promo. Scrubbing a bar
 *      blind and guessing is the thing that makes this job slow.
 *
 * Frames are captured client-side by drawing the <video> onto a canvas. That
 * needs no server work and no extra storage, and it stays exact — the frame
 * shown is the frame at that timestamp, not an approximation from a sprite
 * sheet generated at a fixed interval.
 */
export function ClipTool({ source }: { source: Source }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [state, formAction] = useActionState<StudioState, FormData>(createClip, null)

  const { ready, error: playerError } = useHlsVideo(videoRef, source.playbackUrl)

  const [duration, setDuration] = useState(source.durationSeconds ?? 0)
  const [currentTime, setCurrentTime] = useState(0)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(Math.min(source.durationSeconds ?? 360, 360))

  const [frames, setFrames] = useState<Frame[]>([])
  const [scanning, setScanning] = useState(false)
  const [startPreview, setStartPreview] = useState<string | null>(null)

  const clipLength = Math.max(0, end - start)
  const tooLong = clipLength > MAX_CLIP_SECONDS
  const invalid = end <= start

  /** Seek and wait for the frame to actually be decoded and painted. */
  const seekAndSettle = useCallback((video: HTMLVideoElement, time: number) => {
    return new Promise<void>((resolve) => {
      const done = () => {
        video.removeEventListener('seeked', done)
        // One more frame of grace: 'seeked' fires before the new frame is
        // reliably painted in some browsers, and capturing too early yields
        // the previous frame.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }
      video.addEventListener('seeked', done)
      video.currentTime = Math.max(0, Math.min(time, video.duration || 0))
    })
  }, [])

  const captureFrame = useCallback((): string | null => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return null

    // Thumbnail-sized, preserving aspect ratio.
    const width = 240
    const height = Math.round((video.videoHeight / video.videoWidth) * width)
    canvas.width = width
    canvas.height = height

    const context = canvas.getContext('2d')
    if (!context) return null

    context.drawImage(video, 0, 0, width, height)

    try {
      return canvas.toDataURL('image/jpeg', 0.6)
    } catch {
      // A cross-origin video without CORS headers taints the canvas. Media
      // served from our own origin is fine; a third-party CDN needs
      // Access-Control-Allow-Origin for this to work.
      return null
    }
  }, [])

  /** Walk the video and grab evenly spaced frames for the scene strip. */
  const buildStrip = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.duration || scanning) return

    setScanning(true)
    const resumeAt = video.currentTime
    const wasPaused = video.paused
    video.pause()

    const collected: Frame[] = []

    try {
      for (let i = 0; i < STRIP_FRAMES; i++) {
        // Offset by half a step so the first frame is not the black frame
        // videos so often open on.
        const time = ((i + 0.5) / STRIP_FRAMES) * video.duration
        await seekAndSettle(video, time)
        const dataUrl = captureFrame()
        if (dataUrl) collected.push({ time, dataUrl })
        setFrames([...collected])
      }
    } finally {
      await seekAndSettle(video, resumeAt)
      if (!wasPaused) void video.play().catch(() => {})
      setScanning(false)
    }
  }, [captureFrame, seekAndSettle, scanning])

  // Build the strip once the video is playable and its duration is known.
  useEffect(() => {
    if (!ready || frames.length > 0 || scanning) return
    const video = videoRef.current
    if (!video) return

    if (video.readyState >= 1 && video.duration) {
      void buildStrip()
      return
    }

    const onMeta = () => void buildStrip()
    video.addEventListener('loadedmetadata', onMeta, { once: true })
    return () => video.removeEventListener('loadedmetadata', onMeta)
  }, [ready, frames.length, scanning, buildStrip])

  /** Refresh the large preview of whatever frame the promo starts on. */
  const refreshStartPreview = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.duration || scanning) return

    const resumeAt = video.currentTime
    await seekAndSettle(video, start)
    const dataUrl = captureFrame()
    if (dataUrl) setStartPreview(dataUrl)
    await seekAndSettle(video, resumeAt)
  }, [start, captureFrame, seekAndSettle, scanning])

  function jumpTo(seconds: number) {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(seconds, duration))
  }

  if (state?.success) {
    return (
      <div className="rounded-xl border border-success/30 bg-success/10 p-5">
        <h3 className="text-sm font-semibold text-success">Promo queued</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">{state.success}</p>
        <div className="mt-3 flex gap-2">
          <Link
            href="/studio/videos"
            className="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
          >
            View my videos
          </Link>
          <Link
            href={`/studio/clips?source=${source.id}`}
            className="rounded-lg border border-border px-3.5 py-2 text-xs font-medium text-muted hover:bg-surface-raised"
          >
            Cut another from this source
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <canvas ref={canvasRef} className="hidden" aria-hidden />

      <div className="rounded-xl border border-border bg-surface p-3">
        <p className="mb-2 text-xs text-muted">
          Cutting from <span className="font-medium text-foreground">{source.title}</span>
        </p>

        <video
          ref={videoRef}
          poster={source.poster ?? undefined}
          controls
          playsInline
          preload="metadata"
          crossOrigin="anonymous"
          onLoadedMetadata={(e) => {
            const value = e.currentTarget.duration
            if (Number.isFinite(value) && value > 0) {
              setDuration(value)
              setEnd((prev) => Math.min(prev || 360, value))
            }
          }}
          onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
          className="aspect-video w-full rounded-lg bg-black"
        />

        {playerError && (
          <p className="mt-2 text-xs text-danger">{playerError}</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="tabular-nums">
            Position: {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>
          <button
            type="button"
            onClick={() => setStart(currentTime)}
            className="rounded-lg border border-border px-2 py-1 font-medium hover:border-accent hover:text-accent"
          >
            Set start here
          </button>
          <button
            type="button"
            onClick={() => setEnd(currentTime)}
            className="rounded-lg border border-border px-2 py-1 font-medium hover:border-accent hover:text-accent"
          >
            Set end here
          </button>
        </div>
      </div>

      {/* --- Scene strip ---------------------------------------------------- */}
      <div className="rounded-xl border border-border bg-surface p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold">
            <Images size={14} aria-hidden />
            Scenes
          </h3>
          {scanning ? (
            <span className="flex items-center gap-1.5 text-xs text-muted">
              <Loader2 size={12} className="animate-spin" aria-hidden />
              Reading frames… {frames.length}/{STRIP_FRAMES}
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setFrames([])
                void buildStrip()
              }}
              className="text-xs font-medium text-accent hover:underline"
            >
              Rebuild
            </button>
          )}
        </div>

        {frames.length === 0 && !scanning ? (
          <p className="py-4 text-center text-xs text-muted">
            Scene previews appear once the video has loaded.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
            {frames.map((frame) => {
              const inRange = frame.time >= start && frame.time <= end

              return (
                <button
                  key={frame.time}
                  type="button"
                  onClick={() => jumpTo(frame.time)}
                  title={`Jump to ${formatDuration(frame.time)}`}
                  className={`group relative overflow-hidden rounded-md border-2 transition-colors ${
                    inRange ? 'border-accent' : 'border-transparent hover:border-muted'
                  }`}
                >
                  {/* Frames are canvas data URLs, so next/image would add no
                      value here — there is nothing to optimise or cache. */}
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

        <p className="mt-2 text-[11px] leading-relaxed text-muted">
          Click a scene to jump there, then use{' '}
          <span className="text-foreground">Set start here</span> /{' '}
          <span className="text-foreground">Set end here</span>. Highlighted
          frames fall inside your promo.
        </p>
      </div>

      {/* --- Cut form ------------------------------------------------------- */}
      <form
        action={formAction}
        className="space-y-4 rounded-xl border border-border bg-surface p-4"
      >
        <input type="hidden" name="sourceVideoId" value={source.id} />
        <input type="hidden" name="startSeconds" value={start} />
        <input type="hidden" name="endSeconds" value={end} />

        <FormMessage error={state?.error} />

        <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
          <div className="space-y-4">
            <PointControl
              label="Start"
              value={start}
              max={duration}
              onChange={setStart}
              onUseCurrent={() => setStart(Math.min(currentTime, end - 0.5))}
              onSeek={() => jumpTo(start)}
              errors={state?.fieldErrors?.startSeconds}
            />
            <PointControl
              label="End"
              value={end}
              max={duration}
              onChange={setEnd}
              onUseCurrent={() => setEnd(Math.max(currentTime, start + 0.5))}
              onSeek={() => jumpTo(end)}
              errors={state?.fieldErrors?.endSeconds}
            />
          </div>

          {/* The frame the promo opens on — the single most important image,
              since it becomes the thumbnail viewers judge the promo by. */}
          <div className="sm:w-40">
            <p className="text-xs font-medium">Opening frame</p>
            <div className="mt-1 aspect-video w-full overflow-hidden rounded-lg border border-border bg-background">
              {startPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={startPreview} alt="" className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-[10px] text-muted">
                  Not previewed
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => void refreshStartPreview()}
              disabled={scanning}
              className="mt-1 w-full rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-accent disabled:opacity-50"
            >
              Preview start
            </button>
          </div>
        </div>

        <div
          className={`rounded-lg border p-2.5 text-xs ${
            invalid || tooLong
              ? 'border-danger/30 bg-danger/10 text-danger'
              : 'border-border bg-background text-muted'
          }`}
        >
          Promo length:{' '}
          <span className="font-semibold tabular-nums">{formatDuration(clipLength)}</span>
          {invalid && ' — the end must come after the start.'}
          {tooLong && ` — maximum is ${MAX_CLIP_SECONDS / 60} minutes.`}
          {!invalid && !tooLong && clipLength > 0 && clipLength < 60 && (
            <span> — that is very short for a promo.</span>
          )}
        </div>

        <Field
          label="Promo title"
          name="title"
          required
          defaultValue={source.title}
          errors={state?.fieldErrors?.title}
        />

        <CheckboxField name="isPromo" defaultChecked>
          This is a promo preview cut from a full-length movie.
        </CheckboxField>

        <SubmitButton className="w-full" pendingLabel="Queueing…">
          <span className="inline-flex items-center gap-1.5">
            <Scissors size={14} aria-hidden />
            Create promo
          </span>
        </SubmitButton>
      </form>
    </div>
  )
}

function PointControl({
  label,
  value,
  max,
  onChange,
  onUseCurrent,
  onSeek,
  errors,
}: {
  label: string
  value: number
  max: number
  onChange: (value: number) => void
  onUseCurrent: () => void
  onSeek: () => void
  errors?: string[]
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium">{label}</span>
        <span className="text-xs tabular-nums text-muted">{formatDuration(value)}</span>
      </div>

      <input
        type="range"
        min={0}
        max={max || 0}
        step={0.1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label} position`}
        className="mt-1 h-1 w-full cursor-pointer appearance-none rounded-full bg-surface-raised accent-[var(--accent)]"
      />

      <div className="mt-1.5 flex gap-1.5">
        <button
          type="button"
          onClick={onUseCurrent}
          className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-accent"
        >
          Use current
        </button>
        <button
          type="button"
          onClick={onSeek}
          className="rounded-lg border border-border px-2 py-1 text-[11px] font-medium text-muted hover:border-accent hover:text-accent"
        >
          Jump to {label.toLowerCase()}
        </button>
      </div>

      {errors?.[0] && <p className="mt-1 text-xs text-danger">{errors[0]}</p>}
    </div>
  )
}
