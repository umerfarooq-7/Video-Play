/**
 * Does this request come from a search or preview crawler rather than a
 * person?
 *
 * Used for one thing only: letting crawlers past the age interstitial. Without
 * it every public URL answers a crawler with a redirect to /age-check, so the
 * sitemap lists hundreds of pages none of them can read, no video page can
 * rank, and AdSense cannot verify the site because its crawler never reaches
 * the markup either.
 *
 * This is user-agent matching, which anybody can spoof. That is a real
 * limitation and worth being plain about: someone who sets their browser's
 * user agent to Googlebot skips the interstitial. It is a deliberate trade,
 * because the interstitial is a self-declaration — one click, no verification —
 * so what is being bypassed is a click, not an age check. Verifying crawlers
 * properly means a reverse DNS lookup per request, and proxy.ts runs on every
 * request site-wide. If real age assurance is ever added (see
 * docs/COMPLIANCE.md), it must NOT reuse this exemption.
 */
const CRAWLERS =
  /(googlebot|google-inspectiontool|storebot-google|google-extended|adsbot-google|mediapartners-google|apis-google|bingbot|bingpreview|adidxbot|duckduckbot|baiduspider|yandex(bot|images|mobilebot)|applebot|petalbot|seznambot|qwantify|sogou|exabot|facebookexternalhit|facebookcatalog|twitterbot|linkedinbot|pinterest(bot)?|redditbot|slackbot|discordbot|telegrambot|whatsapp|skypeuripreview|ia_archiver)/

export function isSearchCrawler(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  return CRAWLERS.test(userAgent.toLowerCase())
}
