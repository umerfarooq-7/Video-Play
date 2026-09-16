'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Scissors, Trash2 } from 'lucide-react'
import { formatDuration } from '@/lib/format'
import { STRIP_FRAMES, type VideoFrames } from '@/lib/studio/use-video-frames'
import type { Scene } from '@/lib/studio/cut-scenes'

/** Shorter than this is almost certainly a mis-click. */
const MIN_SCENE_SECONDS = 1

/**
 * Choose the scenes that make up the promo, before anything is uploaded.
 *
 * Only these scenes are sent to the server: on submit they are cut out of the
 * local file and joined, and the full movie never leaves the uploader's
 * machine. With no scenes chosen the whole file is uploaded as it is, for a
 * video that is already a finished promo.
 *
 * Scenes are marked on a real player, because a strip of stills cannot show
 * where a scene actually begins and ends. The strip is kept as a quick way to
 * jump around a long movie.
 */
export function ScenePicker({
  file,
  frames,
  duration,
  scanning,
  error,
  captureAt,
  scenes,
  onScenesChange,
}: Pick<VideoFrames, 'frames' | 'duration' | 'scanning' | 'error' | 'captureAt'> & {
  file: File
  scenes: Scene[]
  onScenesChange: (scenes: Scene[]) => void
}) {
  const playerRef = useRef<HTMLVideoElement>(null)
  const [now, setNow] = useState(0)
  const [pendingStart, setPendingStart] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  // The visible player gets its own object URL. revokeObjectURL on cleanup
  // stops the browser pinning the whole file in memory.
  useEffect(() => {
    const player = playerRef.current
    if (!player) return
    const url = URL.createObjectURL(file)
    player.src = url
    return () => {
      player.removeAttribute('src')
      player.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  // A small still for each scene, so the list reads at a glance. Captured on
  // the scanning video, which queues requests, so this never fights the strip.
  const requested = useRef(new Set<string>())
  useEffect(() => {
    if (scanning) return
    for (const scene of scenes) {
      const key = scene.start.toFixed(2)
      if (requested.current.has(key)) continue
      requested.current.add(key)
      void captureAt(scene.start + 0.5, 160).then((url) => {
        if (url) setThumbs((prev) => ({ ...prev, [key]: url }))
      })
    }
  }, [scenes, scanning, captureAt])

  const total = scenes.reduce((sum, s) => sum + (s.end - s.start), 0)

  function seek(time: number, play = false) {
    const player = playerRef.current
    if (!player) return
    player.currentTime = time
    if (play) void player.play()
  }

  function markStart() {
    setMessage(null)
    setPendingStart(playerRef.current?.currentTime ?? 0)
  }

  function markEnd() {
    if (pendingStart === null) return
    const end = playerRef.current?.currentTime ?? 0

    if (end - pendingStart < MIN_SCENE_SECONDS) {
      setMessage('The end has to come after the start. Play on or scrub forward, then mark the end.')
      return
    }

    onScenesChange(addScene(scenes, { start: pendingStart, end }))
    setPendingStart(null)
    setMessage(null)
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold">
          <Scissors size={13} aria-hidden />
          Choose the promo scenes
        </p>
        {scanning ? (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Loader2 size={11} className="animate-spin" aria-hidden />
            Reading frames… {frames.length}/{STRIP_FRAMES}
          </span>
        ) : (
          <span className="text-xs text-muted">
            {scenes.length} scene{scenes.length === 1 ? '' : 's'} · {formatDuration(total)} promo
          </span>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}

      <p className="text-[11px] leading-relaxed text-muted">
        Play or scrub to where a scene begins and press <strong>Mark start</strong>, then
        to where it ends and press <strong>Mark end</strong>. Repeat for every scene.
        Only these scenes are uploaded, joined in order — not the full video.
      </p>

      <video
        ref={playerRef}
        controls
        muted
        playsInline
        preload="metadata"
        onTimeUpdate={(event) => setNow(event.currentTarget.currentTime)}
        onSeeked={(event) => setNow(event.currentTarget.currentTime)}
        className="aspect-video w-full rounded bg-black"
      />

      <div className="flex flex-wrap items-center gap-2">
        {pendingStart === null ? (
          <button
            type="button"
            onClick={markStart}
            disabled={!duration}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:bg-accent-hover disabled:opacity-40"
          >
            Mark start at {formatDuration(now)}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={markEnd}
              className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-accent-contrast hover:bg-accent-hover"
            >
              Mark end at {formatDuration(now)}
            </button>
            <span className="text-xs text-muted">
              Scene starts at {formatDuration(pendingStart)}
            </span>
            <button
              type="button"
              onClick={() => {
                setPendingStart(null)
                setMessage(null)
              }}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-raised"
            >
              Cancel
            </button>
          </>
        )}
      </div>

      {message && <p className="text-xs text-danger">{message}</p>}

      {frames.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] text-muted">Jump to:</p>
          <div className="grid grid-cols-5 gap-1.5">
            {frames.map((frame) => (
              <button
                key={frame.time}
                type="button"
                onClick={() => seek(frame.time)}
                title={`Jump to ${formatDuration(frame.time)}`}
                className="relative overflow-hidden rounded border-2 border-transparent hover:border-accent"
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
            ))}
          </div>
        </div>
      )}

      {scenes.length === 0 ? (
        <p className="rounded border border-dashed border-border p-2 text-center text-[11px] text-muted">
          No scenes chosen — the whole video will be uploaded as it is.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {scenes.map((scene, index) => {
            const thumb = thumbs[scene.start.toFixed(2)]
            return (
              <li
                key={`${scene.start}-${scene.end}`}
                className="flex items-center gap-2 rounded border border-border bg-surface p-1.5"
              >
                <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[10px] font-bold text-accent-contrast">
                  {index + 1}
                </span>
                <div className="aspect-video w-16 shrink-0 overflow-hidden rounded bg-black">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <span className="min-w-0 flex-1 text-xs tabular-nums">
                  {formatDuration(scene.start)} – {formatDuration(scene.end)}
                  <span className="text-muted"> · {formatDuration(scene.end - scene.start)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => seek(scene.start, true)}
                  aria-label={`Play scene ${index + 1}`}
                  className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-foreground"
                >
                  <Play size={13} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onScenesChange(scenes.filter((s) => s !== scene))}
                  aria-label={`Remove scene ${index + 1}`}
                  className="rounded p-1.5 text-muted hover:bg-surface-raised hover:text-danger"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              </li>
            )
          })}
        </ol>
      )}

      {scenes.length > 0 && (
        <p className="text-[11px] leading-relaxed text-muted">
          Cuts land on the nearest keyframe, so each scene can begin a second or two early
          and end a second or two late. That is what keeps the cut instant and the quality
          untouched.
        </p>
      )}

      {/* Read by the upload form, which does the cutting on submit. */}
      <input type="hidden" name="promoScenes" value={JSON.stringify(scenes)} />
    </div>
  )
}

/** Add a scene in time order, folding it into any scene it overlaps. */
function addScene(scenes: Scene[], next: Scene): Scene[] {
  const sorted = [...scenes, next].sort((a, b) => a.start - b.start)
  const merged: Scene[] = []
  for (const scene of sorted) {
    const last = merged[merged.length - 1]
    const rounded = { start: Number(scene.start.toFixed(2)), end: Number(scene.end.toFixed(2)) }
    if (last && rounded.start <= last.end) last.end = Math.max(last.end, rounded.end)
    else merged.push(rounded)
  }
  return merged
}
