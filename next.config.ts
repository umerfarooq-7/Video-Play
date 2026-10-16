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
      // little over the bucket's own 50MB ceiling, because the limit counts
      // the multipart boundaries and part headers as well as the file.
      bodySizeLimit: '52mb',
    },
    // The one that actually bit. proxy.ts runs on every request, and Next
    // buffers the body for it — capped at 10MB by default. Past that the body
    // is truncated and the action fails with "Unexpected end of form", which
    // says nothing about a size limit. Raising bodySizeLimit alone changed
    // nothing, because the body never arrived intact in the first place.
    proxyClientMaxBodySize: '52mb',
  },
}

export default nextConfig
