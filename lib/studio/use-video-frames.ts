'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/** Frames offered across the video. */
export const STRIP_FRAMES = 10

export interface Frame {
  time: number
  dataUrl: string
}

export interface VideoFrames {
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
  onLoadedMetadata: () => void
  frames: Frame[]
  duration: number
  scanning: boolean
  error: string | null
  /** Grab any moment, not just the ten on the strip. */
  captureAt: (time: number, width?: number) => Promise<string | null>
}

/**
 * Read still frames out of a file that has not been uploaded yet.
 *
 * Everything happens in the browser against the local file: an object URL
 * feeds a hidden <video> and frames are drawn onto a canvas. No upload, no
 * server, no CORS, and seeking is instant because the bytes are already on the
 * machine.
 *
 * The caller renders the hidden <video> and <canvas> and wires up the refs, so
 * that several pickers can share one scan of a file that may be gigabytes.
 */
export function useVideoFrames(file: File): VideoFrames {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [duration, setDuration] = useState(0)
  const [frames, setFrames] = useState<Frame[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // One video element cannot serve two seeks at once, and a capture that
  // starts mid-seek returns the wrong frame. Every request joins this chain.
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  // 'loadedmetadata' can fire more than once for the same source. A second
  // scan would interleave with the first through the queue above and the two
  // would overwrite each other's frames.
  const scanned = useRef(false)

  // revokeObjectURL matters: without it the browser pins the whole file in
  // memory until the tab closes.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const url = URL.createObjectURL(file)
    scanned.current = false
    video.src = url

    return () => {
      video.removeAttribute('src')
      video.load()
      URL.revokeObjectURL(url)
    }
  }, [file])

  const seekAndSettle = useCallback((video: HTMLVideoElement, time: number) => {
    return new Promise<void>((resolve) => {
      let settled = false

      const finish = () => {
        if (settled) return
        settled = true
        video.removeEventListener('seeked', onSeeked)
        clearTimeout(giveUp)
        resolve()
      }

      const onSeeked = () => {
        // 'seeked' fires before the new frame is reliably painted in some
        // browsers, and capturing early yields the previous one. Wait a frame
        // for it — but on a timer as well, because requestAnimationFrame stops
        // firing altogether while the tab is in the background, which would
        // otherwise stall the scan until the user came back to it.
        requestAnimationFrame(() => requestAnimationFrame(finish))
        setTimeout(finish, 120)
      }

      // A seek that never lands must not wedge the queue every later capture
      // is waiting behind.
      const giveUp = setTimeout(finish, 5000)

      video.addEventListener('seeked', onSeeked)
      video.currentTime = Math.max(0, Math.min(time, video.duration || 0))
    })
  }, [])

  const draw = useCallback((width: number): string | null => {
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
      return canvas.toDataURL('image/jpeg', 0.7)
    } catch {
      // A cross-origin frame taints the canvas. Cannot happen for a local
      // file, but toDataURL throwing must not take the form down with it.
      return null
    }
  }, [])

  const captureAt = useCallback(
    (time: number, width = 320): Promise<string | null> => {
      const next = queue.current.then(async () => {
        const video = videoRef.current
        if (!video || !video.duration) return null
        await seekAndSettle(video, time)
        return draw(width)
      })

      // Keep the chain alive even if one capture throws.
      queue.current = next.catch(() => null)
      return next
    },
    [draw, seekAndSettle],
  )

  const buildStrip = useCallback(
    async (total: number) => {
      setScanning(true)
      const collected: Frame[] = []

      try {
        for (let i = 0; i < STRIP_FRAMES; i++) {
          // Half-step offset: the opening frame of a video is very often black.
          const time = ((i + 0.5) / STRIP_FRAMES) * total
          const dataUrl = await captureAt(time, 240)
          if (dataUrl) collected.push({ time, dataUrl })
          setFrames([...collected])
        }
      } finally {
        setScanning(false)
      }
    },
    [captureAt],
  )

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current
    if (!video) return

    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      setError('Could not read that file. Try a different format.')
      return
    }

    setDuration(video.duration)

    if (scanned.current) return
    scanned.current = true
    void buildStrip(video.duration)
  }, [buildStrip])

  return {
    videoRef,
    canvasRef,
    onLoadedMetadata,
    frames,
    duration,
    scanning,
    error,
    captureAt,
  }
}
