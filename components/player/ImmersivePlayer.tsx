'use client'

import { useEffect, useRef, useState } from 'react'
import { Play, Pause, Maximize, Loader2, RotateCcw } from 'lucide-react'
import type { VideoProjection } from '@/types/database'
import { formatDuration } from '@/lib/format'

/**
 * VR / 360 / 180 player.
 *
 * The video is drawn as a texture on the *inside* of a sphere: the geometry is
 * scaled by -1 on X to flip its normals inward, which also mirrors the image,
 * so the texture is flipped back by repeating at -1. Doing it this way is far
 * cheaper than building custom geometry.
 *
 * Projection handling:
 *   eq360_*  full sphere        (phiLength = 2π)
 *   eq180_*  front hemisphere   (phiLength = π, rotated to face the viewer)
 *   *_stereo_tb   frames stacked top/bottom  — show the top half
 *   *_stereo_sbs  frames side by side        — show the left half
 * Only one eye is rendered on a flat screen; a true stereo pair needs a
 * headset and WebXR, which is a separate build.
 *
 * three.js is imported dynamically so its bulk only loads for immersive
 * videos, not on every watch page.
 */
export function ImmersivePlayer({
  src,
  poster,
  projection,
}: {
  src: string
  poster?: string | null
  projection: VideoProjection
}) {
  const mountRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  // Assigned once three.js has built the scene; drives the "reset view" button.
  const resetViewRef = useRef<(() => void) | undefined>(undefined)

  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    let disposed = false
    let cleanup: (() => void) | undefined

    // A plain <video> element is the texture source. It stays out of the DOM
    // tree visually but must remain attached for some browsers to decode it.
    const video = document.createElement('video')
    video.src = src
    video.crossOrigin = 'anonymous'
    video.loop = false
    video.playsInline = true
    video.preload = 'metadata'
    videoRef.current = video

    import('three')
      .then((THREE) => {
        if (disposed) return

        const scene = new THREE.Scene()
        const camera = new THREE.PerspectiveCamera(
          75,
          mount.clientWidth / Math.max(mount.clientHeight, 1),
          0.1,
          1000,
        )
        // Sit at the centre of the sphere looking out.
        camera.position.set(0, 0, 0.01)

        const renderer = new THREE.WebGLRenderer({ antialias: true })
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        renderer.setSize(mount.clientWidth, mount.clientHeight)
        mount.appendChild(renderer.domElement)

        const is180 = projection.startsWith('eq180')
        const phiLength = is180 ? Math.PI : Math.PI * 2
        const phiStart = is180 ? Math.PI / 2 : 0

        const geometry = new THREE.SphereGeometry(
          500,
          60,
          40,
          phiStart,
          phiLength,
        )
        // Flip normals inward so we see the texture from inside.
        geometry.scale(-1, 1, 1)

        const texture = new THREE.VideoTexture(video)
        texture.colorSpace = THREE.SRGBColorSpace

        // Show one eye of a stereo pair.
        if (projection.endsWith('stereo_tb')) {
          texture.repeat.set(1, 0.5)
          texture.offset.set(0, 0.5) // top half
        } else if (projection.endsWith('stereo_sbs')) {
          texture.repeat.set(0.5, 1)
          texture.offset.set(0, 0) // left half
        }

        const material = new THREE.MeshBasicMaterial({ map: texture })
        const sphere = new THREE.Mesh(geometry, material)
        scene.add(sphere)

        // --- Look controls: drag to pan, wheel to zoom -----------------------
        let longitude = 0
        let latitude = 0
        let dragging = false
        let lastX = 0
        let lastY = 0

        const onPointerDown = (event: PointerEvent) => {
          dragging = true
          lastX = event.clientX
          lastY = event.clientY
          renderer.domElement.setPointerCapture(event.pointerId)
        }

        const onPointerMove = (event: PointerEvent) => {
          if (!dragging) return
          // Dragging right should turn the view left, like looking around.
          longitude -= (event.clientX - lastX) * 0.15
          latitude += (event.clientY - lastY) * 0.15
          latitude = Math.max(-85, Math.min(85, latitude))
          lastX = event.clientX
          lastY = event.clientY
        }

        const onPointerUp = (event: PointerEvent) => {
          dragging = false
          renderer.domElement.releasePointerCapture?.(event.pointerId)
        }

        const onWheel = (event: WheelEvent) => {
          event.preventDefault()
          camera.fov = Math.max(30, Math.min(100, camera.fov + event.deltaY * 0.05))
          camera.updateProjectionMatrix()
        }

        renderer.domElement.addEventListener('pointerdown', onPointerDown)
        renderer.domElement.addEventListener('pointermove', onPointerMove)
        renderer.domElement.addEventListener('pointerup', onPointerUp)
        renderer.domElement.addEventListener('pointercancel', onPointerUp)
        renderer.domElement.addEventListener('wheel', onWheel, { passive: false })

        const onResize = () => {
          if (!mount.clientWidth) return
          camera.aspect = mount.clientWidth / Math.max(mount.clientHeight, 1)
          camera.updateProjectionMatrix()
          renderer.setSize(mount.clientWidth, mount.clientHeight)
        }
        const observer = new ResizeObserver(onResize)
        observer.observe(mount)

        let frame = 0
        const render = () => {
          frame = requestAnimationFrame(render)

          const phi = THREE.MathUtils.degToRad(90 - latitude)
          const theta = THREE.MathUtils.degToRad(longitude)

          camera.lookAt(
            500 * Math.sin(phi) * Math.cos(theta),
            500 * Math.cos(phi),
            500 * Math.sin(phi) * Math.sin(theta),
          )

          renderer.render(scene, camera)
        }
        render()

        // Expose a reset for the control bar.
        resetViewRef.current = () => {
          longitude = 0
          latitude = 0
          camera.fov = 75
          camera.updateProjectionMatrix()
        }

        setReady(true)

        cleanup = () => {
          cancelAnimationFrame(frame)
          observer.disconnect()
          renderer.domElement.removeEventListener('pointerdown', onPointerDown)
          renderer.domElement.removeEventListener('pointermove', onPointerMove)
          renderer.domElement.removeEventListener('pointerup', onPointerUp)
          renderer.domElement.removeEventListener('pointercancel', onPointerUp)
          renderer.domElement.removeEventListener('wheel', onWheel)
          // WebGL contexts are a finite resource; leaking them across
          // navigations eventually kills rendering for the whole tab.
          texture.dispose()
          geometry.dispose()
          material.dispose()
          renderer.dispose()
          renderer.domElement.remove()
        }
      })
      .catch(() => {
        if (!disposed) setError('Could not load the 360 player.')
      })

    const onTime = () => setCurrentTime(video.currentTime)
    const onMeta = () => setDuration(video.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)

    video.addEventListener('timeupdate', onTime)
    video.addEventListener('loadedmetadata', onMeta)
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)

    return () => {
      disposed = true
      cleanup?.()
      video.removeEventListener('timeupdate', onTime)
      video.removeEventListener('loadedmetadata', onMeta)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.pause()
      video.src = ''
      video.load()
    }
  }, [src, projection])

  function togglePlay() {
    const video = videoRef.current
    if (!video) return
    if (video.paused) void video.play().catch(() => setError('Playback was blocked.'))
    else video.pause()
  }

  async function goFullscreen() {
    await mountRef.current?.parentElement?.requestFullscreen().catch(() => {})
  }

  const label = projection.startsWith('eq180') ? '180°' : '360°'

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
      <div ref={mountRef} className="h-full w-full cursor-grab active:cursor-grabbing" />

      {poster && !ready && !error && (
        // eslint-disable-next-line @next/next/no-img-element -- decorative
        // placeholder swapped out the moment the WebGL canvas is ready.
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover" />
      )}

      {!ready && !error && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/50">
          <Loader2 size={36} className="animate-spin text-white/80" aria-hidden />
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 p-4 text-center">
          <p className="text-sm text-white">{error}</p>
        </div>
      )}

      <span className="pointer-events-none absolute left-3 top-3 rounded bg-accent px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-accent-contrast">
        {label}
      </span>

      {ready && !error && (
        <p className="pointer-events-none absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-[10px] text-white/80">
          Drag to look around · scroll to zoom
        </p>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-black/90 to-transparent px-3 pb-2 pt-8 text-white">
        <button type="button" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause size={18} aria-hidden /> : <Play size={18} aria-hidden />}
        </button>

        <label htmlFor="vr-seek" className="sr-only">
          Seek
        </label>
        <input
          id="vr-seek"
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={currentTime}
          onChange={(e) => {
            const video = videoRef.current
            if (video) video.currentTime = Number(e.target.value)
          }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/25 accent-[var(--accent)]"
        />

        <span className="text-xs tabular-nums">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>

        <button type="button" onClick={() => resetViewRef.current?.()} aria-label="Reset view">
          <RotateCcw size={17} aria-hidden />
        </button>

        <button type="button" onClick={goFullscreen} aria-label="Full screen">
          <Maximize size={17} aria-hidden />
        </button>
      </div>
    </div>
  )
}
