import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Ad, AdPlacement } from '@/types/database'

/** The fields a public page needs. `html_code` is only read for a snippet. */
export interface AdCreative {
  id: string
  kind: Ad['kind']
  imageUrl: string | null
  htmlCode: string | null
  videoUrl: string | null
  width: number | null
  height: number | null
  skipAfterSeconds: number
  /** True when the ad links somewhere, so the slot knows to make it clickable. */
  clickable: boolean
}

function toCreative(row: Ad): AdCreative {
  return {
    id: row.id,
    kind: row.kind,
    imageUrl: row.image_url,
    htmlCode: row.html_code,
    videoUrl: row.video_url,
    width: row.width,
    height: row.height,
    skipAfterSeconds: row.skip_after_seconds,
    clickable: !!row.target_url,
  }
}

/**
 * Live ads for one slot.
 *
 * The active flag and the flight window are applied here as well as in RLS.
 * RLS lets staff read everything — that is what the admin list is built on —
 * so without this an admin browsing the site would be the one person seeing
 * the paused campaigns.
 */
export async function listAdsFor(placement: AdPlacement): Promise<AdCreative[]> {
  const supabase = await createClient()

  const { data } = await supabase
    .from('ads')
    .select('*')
    .eq('placement', placement)
    .eq('is_active', true)
    .order('sort_order')
    .limit(20)

  // The flight window is applied here rather than in the query. A timestamp
  // carries dots and colons, which are PostgREST's own separators inside an
  // `or` filter, and there are at most twenty rows to look at.
  const now = Date.now()

  return ((data ?? []) as Ad[])
    .filter(
      (ad) =>
        (!ad.starts_at || Date.parse(ad.starts_at) <= now) &&
        (!ad.ends_at || Date.parse(ad.ends_at) > now),
    )
    .map(toCreative)
}

/**
 * Choose one ad from a slot, spreading several campaigns across the library.
 *
 * Keyed off the page rather than random: a random pick during render is
 * unstable across re-renders and defeats caching, so the same video would
 * have to be rendered fresh for every visitor just to shuffle a banner. This
 * gives each video a fixed ad and different videos different ads, which
 * divides the impressions the same way over any real amount of traffic.
 */
export function pickAd(ads: AdCreative[], seed: string): AdCreative | null {
  if (ads.length === 0) return null
  if (ads.length === 1) return ads[0]

  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0
  }

  return ads[Math.abs(hash) % ads.length]
}

export interface HomeBannerSettings {
  /** 'top' puts one banner above the grids; 'interval' repeats it between them. */
  position: 'top' | 'interval'
  /** Videos between banners, when repeating. */
  interval: number
}

/** How the home page shows its banners. */
export async function getHomeBannerSettings(): Promise<HomeBannerSettings> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('ad_settings')
    .select('home_grid_interval, home_banner_position')
    .limit(1)
    .maybeSingle()

  return {
    position: data?.home_banner_position === 'interval' ? 'interval' : 'top',
    interval: data?.home_grid_interval ?? 15,
  }
}
