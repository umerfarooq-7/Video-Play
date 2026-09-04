'use client'

import dynamic from 'next/dynamic'
import type { VideoProjection } from '@/types/database'
import { VideoPlayer } from './VideoPlayer'

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
}: {
  src: string
  poster?: string | null
  projection: VideoProjection
}) {
  if (projection === 'flat') {
    return <VideoPlayer src={src} poster={poster} />
  }

  return <ImmersivePlayer src={src} poster={poster} projection={projection} />
}
