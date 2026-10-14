import 'server-only'

/**
 * The site's own origin, without a trailing slash.
 *
 * robots.txt and sitemap.xml must carry absolute URLs, and they must be the
 * canonical ones: a sitemap listing localhost — or the same page under two
 * hostnames — is worse than no sitemap at all. The value is read from the same
 * NEXT_PUBLIC_SITE_URL the metadata base uses, so there is one place to change
 * when the domain does.
 */
export function siteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  return raw.replace(/\/+$/, '')
}
