'use client'

import dynamic from 'next/dynamic'
import type { VideoProjection } from '@/types/database'
import type { AdCreative } from '@/lib/ads/queries'
import { VideoPlayer } from './VideoPlayer'
import { PrerollGate } from './PrerollGate'

// The immersive player pulls in three.js. Loading it lazily and only for
// immersive videos keeps that weight off every ordinary watch page.
const ImmersivePlayer = dynamic(
  () => import('./ImmersivePlayer').then((m) => m.ImmersivePlayer),
  {
    ssr: false,
    loading: () => (
      <div className="aspect-video w-full animate-pulse rounded-xl bg-surface" />
    ),
  },
)

export function Player({
  src,
  poster,
  projection,
  preroll,
}: {
  src: string
  poster?: string | null
  projection: VideoProjection
  /** Ad clip to play first. Absent when no campaign is running. */
  preroll?: AdCreative | null
}) {
  const player = (autoPlay: boolean) =>
    projection === 'flat' ? (
      <VideoPlayer src={src} poster={poster} autoPlay={autoPlay} />
    ) : (
      // The immersive player builds its own scene and has no autoplay to pass;
      // after a pre-roll the viewer presses play once more here.
      <ImmersivePlayer src={src} poster={poster} projection={projection} />
    )

  if (!preroll) return player(false)

  return (
    <PrerollGate ad={preroll} poster={poster}>
      {(finished) => player(finished)}
    </PrerollGate>
  )
}
