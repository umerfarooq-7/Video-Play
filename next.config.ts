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
  experimental: {
    serverActions: {
      // Ad creatives are uploaded through a server action, and a pre-roll clip
      // runs to several megabytes. The 1MB default rejects those before the
      // action ever runs, with an error that says nothing about the size. A
      // little over the bucket's own 25MB ceiling, because the limit counts
      // the multipart boundaries and part headers as well as the file.
      bodySizeLimit: '26mb',
    },
  },
}

export default nextConfig
