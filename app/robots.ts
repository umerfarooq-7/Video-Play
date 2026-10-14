import type { MetadataRoute } from 'next'
import { siteUrl } from '@/lib/seo/site-url'

/**
 * Served at /robots.txt.
 *
 * The disallow list is everything that is either private, personalised, or an
 * infinite space a crawler can fall into. `/search` is the last of those: every
 * combination of query, sort and filter is a distinct URL, and left open a
 * crawler will spend its whole budget there instead of on the videos.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/studio',
        '/account',
        '/api',
        '/auth',
        '/age-check',
        '/suspended',
        '/media',
        '/search',
        // Signed-in profile pages: thin, and nothing a searcher is looking for.
        '/u/',
      ],
    },
    sitemap: `${siteUrl()}/sitemap.xml`,
  }
}
