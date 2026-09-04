'use client'

import { useEffect, useState, type RefObject } from 'react'

/**
 * Attach an HLS source to a <video>, using the right mechanism per browser.
 *
 * Safari/iOS play .m3u8 natively and loading hls.js there fights the native
 * implementation; everything else needs Media Source Extensions via hls.js.
 * Getting this wrong is silent: a plain `<video src="…m3u8">` shows a black
 * frame in Chrome with no error, which is exactly how the clip tool was broken.
 *
 * hls.js is imported dynamically so its weight is only paid when actually used.
 */
export function useHlsVideo(
  videoRef: RefObject<HTMLVideoElement | null>,
  src: string | null,
) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (!video || !src) return

    setReady(false)
    setError(null)

    const isHls = src.includes('.m3u8')
    let destroy: (() => void) | undefined
    let cancelled = false

    if (!isHls || video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      setReady(true)
      return
    }

    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return

        if (!Hls.isSupported()) {
          setError('This browser cannot play the video format.')
          return
        }

        const hls = new Hls({ enableWorker: true })
        hls.loadSource(src)
        hls.attachMedia(video)

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (!cancelled) setReady(true)
        })

        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return
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
  }, [videoRef, src])

  return { ready, error }
}
