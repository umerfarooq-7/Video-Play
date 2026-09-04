'use client'

import { useEffect, useRef } from 'react'
import { recordView } from '@/lib/watch/actions'

/**
 * Fires the view count once per page mount.
 *
 * A ref guard is needed because React runs effects twice in development Strict
 * Mode, and the count would otherwise be double-fired on every local load. The
 * database RPC de-duplicates per viewer per hour anyway, so this is belt and
 * braces rather than the only defence.
 *
 * Renders nothing.
 */
export function ViewCounter({ videoId }: { videoId: string }) {
  const fired = useRef(false)

  useEffect(() => {
    if (fired.current) return
    fired.current = true
    void recordView(videoId)
  }, [videoId])

  return null
}
