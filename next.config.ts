import type { NextConfig } from 'next'

/**
 * Allow next/image to load thumbnails from wherever the video provider serves
 * them.
 *
 * The `local` driver should use a relative base (`/media`), which needs no
 * entry here — a same-origin path is not a "remote" image, and routing it
 * through an absolute localhost URL would make the optimizer fetch the app
 * over HTTP from itself.
 *
 * A hosted CDN is genuinely remote, so its hostname is derived from
 * VIDEO_CDN_BASE_URL rather than hardcoded. That way switching provider is an
 * env change, not a code change.
 */
function cdnPatterns(): NonNullable<NextConfig['images']>['remotePatterns'] {
  const base = process.env.VIDEO_CDN_BASE_URL

  if (!base || base.startsWith('/')) return []

  try {
    const url = new URL(base)
    return [
      {
        protocol: url.protocol.replace(':', '') as 'http' | 'https',
        hostname: url.hostname,
        port: url.port || undefined,
        pathname: '/**',
      },
    ]
  } catch {
    // A malformed value should not take the build down; lib/env.ts is where
    // configuration is validated.
    return []
  }
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: cdnPatterns(),
  },
}

export default nextConfig
