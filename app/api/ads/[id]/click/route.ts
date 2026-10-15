import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * Count a click on a banner, then send the visitor on to the advertiser.
 *
 * The destination comes from the ad row, never from the request, so this
 * cannot be turned into an open redirect — there is no URL in the query string
 * to tamper with, only an id that either matches a live ad or does not.
 *
 * The count is recorded through an RPC because the visitor is anonymous and
 * RLS gives them no write access to `ads`. A failed count must not cost the
 * advertiser the click, so the redirect happens either way.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: NextRequest,
  { params }: RouteContext<'/api/ads/[id]/click'>,
) {
  const { id } = await params
  const supabase = await createClient()

  // RLS hides ads that are switched off or outside their flight window, so a
  // stale link from a cached page stops working when the campaign ends.
  const { data: ad } = await supabase
    .from('ads')
    .select('target_url')
    .eq('id', id)
    .maybeSingle()

  if (!ad?.target_url || !/^https?:\/\//i.test(ad.target_url)) {
    return NextResponse.redirect(new URL('/', _request.url), 302)
  }

  await supabase.rpc('record_ad_click', { p_ad_id: id })

  const response = NextResponse.redirect(ad.target_url, 302)
  // Nothing about this URL is worth keeping in a cache: the next visitor needs
  // their own click counted.
  response.headers.set('Cache-Control', 'no-store')
  return response
}
