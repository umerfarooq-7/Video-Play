'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings,
  Loader2,
} from 'lucide-react'
import { formatDuration } from '@/lib/format'

export interface PlayerSource {
  /** HLS manifest URL, or a progressive MP4 as a fallback. */
  src: string
  poster?: string | null
}

interface Quality {
  index: number
  label: string
}

/**
 * Standard HTML5 player with adaptive streaming.
 *
 * HLS is delivered two different ways depending on the browser:
 *   - Safari and iOS play .m3u8 natively; loading hls.js there fights the
 *     native implementation and breaks AirPlay, so it is deliberately skipped.
 *   - Everything else needs Media Source Extensions via hls.js.
 * hls.js is imported dynamically so its ~150KB never reaches Safari users, or
 * anyone who only loads a page without a player on it.
 */
export function VideoPlayer({ src, poster }: PlayerSource) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const hideControlsTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [volume, setVolume] = useState(1)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [buffering, setBuffering] = useState(true)
  const [fullscreen, setFullscreen] = useState(false)
  const [controlsVisible, setControlsVisible] = useState(true)
  const [qualities, setQualities] = useState<Quality[]>([])
  const [currentQuality, setCurrentQuality] = useState(-1)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // --- Source attachment ---------------------------------------------------
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const isHls = src.includes('.m3u8')
    let destroy: (() => void) | undefined

    if (!isHls) {
      video.src = src
      return
    }

    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      return
    }

    let cancelled = false

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) {
          if (!cancelled) setError('This browser cannot play the video format.')
          return
        }

        const hls = new Hls({ enableWorker: true, lowLatencyMode: false })
        hls.loadSource(src)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setQualities(
            data.levels.map((level, index) => ({
              index,
              label: level.height ? `${level.height}p` : `${Math.round(level.bitrate / 1000)}k`,
            })),
          )
        })

        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          setCurrentQuality(hls.autoLevelEnabled ? -1 : data.level)
        })

        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          // Network and media errors are usually transient; hls.js can recover
          // from both. Only give up if recovery itself fails.
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
            hls.startLoad()
          } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
            hls.recoverMediaError()
          } else {
            setError('Playback failed.')
            hls.destroy()
          }
        })

        destroy = () => hls.destroy()
      })
      .catch(() => {
        if (!cancelled) setError('Could not load the player.')
      })

    return () => {
      cancelled = true
      destroy?.()
    }
  }, [src])

  // --- Media element events ------------------------------------------------
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onTime = () => setCurrentTime(video.currentTime)
    const onMeta = () => setDuration(video.duration || 0)
    const onWaiting = () => setBuffering(true)
    const onPlaying = () => setBuffering(false)
    const onVolume = () => {
      setMuted(video.muted)
      setVolume(video.volume)
    }

    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('waiting', onWaiting)
    video.addEventListener('playing', onPlaying)
    video.addEventListener('canplay', onPlaying)
    video.addEventListener('volumechange', onVolume)

    return () => {
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('waiting', onWaiting)
      video.removeEventListener('playing', onPlaying)
      video.removeEventListener('canplay', onPlaying)
      video.removeEventListener('volumechange', onVolume)
    }
  }, [])

  useEffect(() => {
    const onFsChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  const togglePlay = useCallback(() => {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setError('Playback was blocked.'))
    else video.pause()
  }, [])

  const seek = useCallback((seconds: number) => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = Math.max(0, Math.min(seconds, video.duration || 0))
  }, [])

  // --- Keyboard shortcuts --------------------------------------------------
  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const video = videoRef.current
      if (!video) return

      // Never hijack typing in a form control that happens to be focused.
      const target = event.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return

      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          togglePlay()
          break
        case 'ArrowLeft':
          event.preventDefault()
          seek(video.currentTime - 5)
          break
        case 'ArrowRight':
          event.preventDefault()
          seek(video.currentTime + 5)
          break
        case 'ArrowUp':
          event.preventDefault()
          video.volume = Math.min(1, video.volume + 0.1)
          break
        case 'ArrowDown':
          event.preventDefault()
          video.volume = Math.max(0, video.volume - 0.1)
          break
        case 'm':
          video.muted = !video.muted
          break
        case 'f':
          void toggleFullscreen()
          break
      }
    },
    [seek, togglePlay],
  )

  async function toggleFullscreen() {
    if (document.fullscreenElement) {
      await document.exitFullscreen().catch(() => {})
    } else {
      await containerRef.current?.requestFullscreen().catch(() => {})
    }
  }

  function showControlsTemporarily() {
    setControlsVisible(true)
    clearTimeout(hideControlsTimer.current)
    hideControlsTimer.current = setTimeout(() => {
      if (!videoRef.current?.paused) setControlsVisible(false)
    }, 2800)
  }

  useEffect(() => () => clearTimeout(hideControlsTimer.current), [])

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  return (
    <div
      ref={containerRef}
      onMouseMove={showControlsTemporarily}
      onMouseLeave={() => playing && setControlsVisible(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="region"
      aria-label="Video player"
      className="group relative aspect-video w-full overflow-hidden rounded-xl bg-black focus:outline-none"
    >
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        onClick={togglePlay}
        className="h-full w-full"
      />

      {buffering && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center">
          <Loader2 size={40} className="animate-spin text-white/80" aria-hidden />
          <span className="sr-only">Loading</span>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/80 p-4 text-center">
          <p className="text-sm text-white">{error}</p>
        </div>
      )}

      {!playing && !buffering && !error && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 grid place-items-center bg-black/20 transition-colors hover:bg-black/30"
        >
          <span className="grid size-16 place-items-center rounded-full bg-accent/90 text-accent-contrast">
            <Play size={28} fill="currentColor" aria-hidden />
          </span>
        </button>
      )}

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-8 transition-opacity ${
          controlsVisible || !playing ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <label htmlFor="seek" className="sr-only">
          Seek
        </label>
        <input
          id="seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => seek(Number(e.target.value))}
          aria-valuetext={`${formatDuration(currentTime)} of ${formatDuration(duration)}`}
          className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/25 accent-[var(--accent)]"
          style={{
            background: `linear-gradient(to right, var(--accent) ${progress}%, rgba(255,255,255,0.25) ${progress}%)`,
          }}
        />

        <div className="mt-1.5 flex items-center gap-2 text-white">
          <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
          </button>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                const video = videoRef.current
                if (video) video.muted = !video.muted
              }}
              aria-label={muted ? 'Unmute' : 'Mute'}
            >
              {muted || volume === 0 ? (
                <VolumeX size={18} aria-hidden />
              ) : (
                <Volume2 size={18} aria-hidden />
              )}
            </button>
            <label htmlFor="volume" className="sr-only">
              Volume
            </label>
            <input
              id="volume"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const video = videoRef.current
                if (!video) return
                video.volume = Number(e.target.value)
                video.muted = Number(e.target.value) === 0
              }}
              className="hidden h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/25 accent-[var(--accent)] sm:block"
            />
          </div>

          <span className="text-xs tabular-nums">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {qualities.length > 1 && (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowSettings((v) => !v)}
                  aria-label="Quality"
                  aria-expanded={showSettings}
                >
                  <Settings size={18} aria-hidden />
                </button>

                {showSettings && (
                  <ul className="absolute bottom-8 right-0 min-w-28 overflow-hidden rounded-lg bg-black/95 py-1 text-xs">
                    <QualityOption
                      label="Auto"
                      active={currentQuality === -1}
                      onSelect={() => {
                        setCurrentQuality(-1)
                        setShowSettings(false)
                      }}
                    />
                    {qualities.map((quality) => (
                      <QualityOption
                        key={quality.index}
                        label={quality.label}
                        active={currentQuality === quality.index}
                        onSelect={() => {
                          setCurrentQuality(quality.index)
                          setShowSettings(false)
                        }}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
            >
              {fullscreen ? <Minimize size={18} aria-hidden /> : <Maximize size={18} aria-hidden />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function QualityOption({
  label,
  active,
  onSelect,
}: {
  label: string
  active: boolean
  onSelect: () => void
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`block w-full px-3 py-1.5 text-left hover:bg-white/10 ${
          active ? 'text-accent' : 'text-white'
        }`}
      >
        {label}
      </button>
    </li>
  )
}
