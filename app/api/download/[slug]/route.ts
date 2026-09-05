import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import { isVideoAvailableIn } from '@/lib/geo'
import { COUNTRY_HEADER } from '@/lib/constants'

/**
 * Direct download for a published video.
 *
 * Redirects to the CDN rather than streaming the bytes through this server: a
 * multi-gigabyte file proxied through a serverless function is a timeout and a
 * bandwidth bill for no benefit. The redirect keeps the authorisation checks
 * on our side while the transfer stays between the visitor and the CDN.
 *
 * The route exists at all — rather than linking the CDN URL straight from the
 * page — so downloads can be revoked per video, geo rules still apply, and the
 * raw storage URL is not baked into the HTML for scrapers to harvest.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  { params }: RouteContext<'/api/download/[slug]'>,
) {
  const { slug } = await params
  const supabase = await createClient()

  const { data: video } = await supabase
    .from('videos')
    .select(
      'id, title, status, provider, download_path, downloads_enabled, allowed_countries, blocked_countries',
    )
    .eq('slug', slug)
    .maybeSingle()

  // RLS hides unpublished rows from anonymous callers anyway; this keeps the
  // response identical for "missing" and "not yours" so the endpoint cannot be
  // used to probe which slugs exist.
  if (!video || video.status !== 'published') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  if (!video.downloads_enabled || !video.download_path) {
    return NextResponse.json(
      { error: 'Downloads are not available for this video.' },
      { status: 403 },
    )
  }

  const country = request.headers.get(COUNTRY_HEADER) || null
  const available = isVideoAvailableIn(
    country,
    video.allowed_countries ?? [],
    video.blocked_countries ?? [],
  )

  if (!available) {
    return NextResponse.json(
      { error: 'This video is not available in your region.' },
      { status: 451 },
    )
  }

  const url = await getProviderFor(video.provider).getPlaybackUrl(video.download_path, {
    expiresInSeconds: 60 * 15,
    countryCode: country,
  })

  if (!url) {
    return NextResponse.json({ error: 'No downloadable file.' }, { status: 404 })
  }

  return NextResponse.redirect(url, {
    // Never let a CDN cache a redirect that may carry a signed, expiring URL.
    headers: { 'cache-control': 'private, no-store' },
  })
}
