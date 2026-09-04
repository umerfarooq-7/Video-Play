/**
 * Country detection and region policy.
 *
 * The site has first-class support for the UK, USA and Germany: each gets its
 * own landing region, locale defaults and content availability rules. Every
 * other country falls back to `INT`.
 */

export const REGIONS = ['GB', 'US', 'DE', 'INT'] as const
export type Region = (typeof REGIONS)[number]

export interface RegionConfig {
  region: Region
  label: string
  locale: string
  /** Category slug promoted on that region's home page. */
  featuredCategory: string | null
  /**
   * Whether the age wall is legally mandatory rather than advisory. Drives a
   * stricter interstitial (no dismissal, no content behind it) for these
   * markets. See COMPLIANCE.md for what "advisory" leaves exposed.
   */
  ageWallMandatory: boolean
}

export const REGION_CONFIG: Record<Region, RegionConfig> = {
  GB: {
    region: 'GB',
    label: 'United Kingdom',
    locale: 'en-GB',
    featuredCategory: 'uk',
    ageWallMandatory: true,
  },
  US: {
    region: 'US',
    label: 'United States',
    locale: 'en-US',
    featuredCategory: 'usa',
    ageWallMandatory: true,
  },
  DE: {
    region: 'DE',
    label: 'Deutschland',
    locale: 'de-DE',
    featuredCategory: 'germany',
    ageWallMandatory: true,
  },
  INT: {
    region: 'INT',
    label: 'International',
    locale: 'en',
    featuredCategory: null,
    ageWallMandatory: false,
  },
}

/** Cookie holding a visitor's manual region override, if they picked one. */
export const REGION_COOKIE = 'site_region'

/**
 * Resolve the visitor's country from edge geo headers.
 *
 * Header precedence reflects who is closest to the client: a CDN in front of
 * the app knows the real source IP, whereas anything we compute later may be
 * looking at a proxy. Falls back to Accept-Language, which is a weak signal
 * but better than nothing for choosing a default locale.
 */
export function detectCountry(headers: Headers): string | null {
  const candidates = [
    headers.get('x-vercel-ip-country'), // Vercel
    headers.get('cf-ipcountry'), // Cloudflare
    headers.get('x-geo-country'), // generic reverse proxy / nginx GeoIP
    headers.get('x-country-code'),
  ]

  for (const value of candidates) {
    if (value && /^[A-Za-z]{2}$/.test(value)) {
      return value.toUpperCase()
    }
  }

  const acceptLanguage = headers.get('accept-language')
  if (acceptLanguage) {
    // e.g. "de-DE,de;q=0.9,en;q=0.8" -> DE
    const match = acceptLanguage.match(/[a-z]{2}-([A-Z]{2})/)
    if (match) return match[1]
  }

  return null
}

/** Map any ISO country code onto one of our four supported regions. */
export function toRegion(country: string | null | undefined): Region {
  if (!country) return 'INT'
  const upper = country.toUpperCase()
  if (upper === 'GB' || upper === 'UK') return 'GB'
  if (upper === 'US') return 'US'
  if (upper === 'DE') return 'DE'
  return 'INT'
}

export function isRegion(value: string | null | undefined): value is Region {
  return !!value && (REGIONS as readonly string[]).includes(value)
}

/**
 * Geo-availability check, mirroring the allowed/blocked arrays on `videos`.
 *
 * An empty `allowed` list means "everywhere except what is blocked"; a
 * non-empty one is an allowlist. Blocks always win. When the country is
 * unknown we fail open, because blocking every visitor whose CDN did not send
 * a geo header would take the site down for anyone behind a privacy proxy.
 */
export function isVideoAvailableIn(
  country: string | null,
  allowed: string[],
  blocked: string[],
): boolean {
  if (!country) return true

  const upper = country.toUpperCase()
  if (blocked.some((c) => c.toUpperCase() === upper)) return false
  if (allowed.length === 0) return true
  return allowed.some((c) => c.toUpperCase() === upper)
}
