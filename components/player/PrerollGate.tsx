'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, SkipForward, Volume2, VolumeX } from 'lucide-react'
import type { AdCreative } from '@/lib/ads/queries'

/**
 * Plays an ad clip, then hands over to the real player.
 *
 * It starts from a poster and a play button rather than playing by itself.
 * That is not politeness — it is the only arrangement that works. A browser
 * blocks autoplay with sound, so an ad that started on its own would be a
 * silent one, and the video afterwards could not start either. Because the
 * viewer presses play here, that gesture unlocks the document, and the real
 * player can roll straight on when the ad finishes.
 *
 * `onFinished` fires exactly once, whether the ad ended, was skipped, or
 * failed to load. An ad server having a bad afternoon must never be the reason
 * somebody cannot watch the video.
 */
export function PrerollGate({
  ad,
  poster,
  children,
}: {
  ad: AdCreative
  poster?: string | null
  /** The real player, rendered once the ad is out of the way. */
  children: (finished: boolean) => React.ReactNode
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [started, setStarted] = useState(false)
  const [finished, setFinished] = useState(false)
  const [muted, setMuted] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [duration, setDuration] = useState(0)

  // Nothing to show once the ad is done; the player below takes the space.
  useEffect(() => {
    if (!started || finished) return
    const video = videoRef.current
    if (!video) return

    void video.play().catch(() => setFinished(true))
  }, [started, finished])

  if (finished || !ad.videoUrl) return <>{children(finished)}</>

  const remaining = Math.max(0, ad.skipAfterSeconds - Math.floor(elapsed))
  const canSkip = started && remaining === 0
  const left = duration > 0 ? Math.max(0, Math.ceil(duration - elapsed)) : null

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <video
        ref={videoRef}
        src={ad.videoUrl}
        poster={poster ?? undefined}
        playsInline
        muted={muted}
        preload="metadata"
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          setElapsed(e.currentTarget.currentTime)
          // Also taken here, because loadedmetadata often fires on the
          // server-rendered element before React has hydrated its handler onto
          // it — in which case the countdown would never appear at all.
          if (e.currentTarget.duration) setDuration(e.currentTarget.duration)
        }}
        onEnded={() => setFinished(true)}
        onError={() => setFinished(true)}
        className="h-full w-full"
      />

      {!started && (
        <button
          type="button"
          onClick={() => setStarted(true)}
          aria-label="Play"
          className="absolute inset-0 grid place-items-center bg-black/40 transition-colors hover:bg-black/25"
        >
          <span className="grid size-16 place-items-center rounded-full bg-accent text-accent-contrast">
            <Play size={28} className="ml-0.5" aria-hidden />
          </span>
        </button>
      )}

      {started && (
        <>
          {/* The whole frame opens the advertiser, which is how a pre-roll is
              normally sold. It sits under the controls below, so Skip and Mute
              stay clickable — those are rendered after it and therefore paint
              on top. */}
          {ad.clickable && (
            <a
              href={`/api/ads/${ad.id}/click`}
              target="_blank"
              rel="sponsored nofollow noopener noreferrer"
              className="absolute inset-0"
            >
              <span className="sr-only">Visit advertiser</span>
            </a>
          )}

          <span className="pointer-events-none absolute left-3 top-3 rounded bg-black/75 px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-white">
            Ad{left !== null && ` · ${left}s`}
          </span>

          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="grid size-9 place-items-center rounded-full bg-black/75 text-white hover:bg-black"
            >
              {muted ? <VolumeX size={16} aria-hidden /> : <Volume2 size={16} aria-hidden />}
            </button>

            <button
              type="button"
              onClick={() => canSkip && setFinished(true)}
              disabled={!canSkip}
              className="flex items-center gap-1.5 rounded-full bg-black/75 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
            >
              {canSkip ? (
                <>
                  Skip ad
                  <SkipForward size={14} aria-hidden />
                </>
              ) : (
                `Skip in ${remaining}`
              )}
            </button>
          </div>

          {ad.clickable && (
            // A visible hint as well as the full-frame link, so it is obvious
            // the ad leads somewhere rather than the click being a surprise.
            <span className="pointer-events-none absolute bottom-3 left-3 rounded-full bg-accent px-3 py-2 text-xs font-bold text-accent-contrast">
              Visit advertiser
            </span>
          )}
        </>
      )}
    </div>
  )
}
