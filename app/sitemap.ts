import type { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { siteUrl } from '@/lib/seo/site-url'

/**
 * Served at /sitemap.xml.
 *
 * Rebuilt at most once an hour. The queries below are cheap, but a sitemap is
 * fetched by every crawler that finds it, and there is nothing in it that
 * needs to be fresher than that.
 */
export const revalidate = 3600

/**
 * A sitemap file may hold 50,000 URLs. These caps keep the total comfortably
 * under that as the library grows; the day videos alone approach the ceiling,
 * this needs splitting into an index with `generateSitemaps`.
 */
const MAX_VIDEOS = 40_000
const MAX_PER_TAXONOMY = 2_000

/**
 * A signed-out client, deliberately.
 *
 * Reading through the request's cookies would make the sitemap depend on
 * whoever happened to trigger the rebuild, and it would mean a logged-in
 * uploader's drafts could decide what a crawler is told about. Anonymous is
 * exactly the view a crawler gets, and RLS enforces it.
 */
function publicClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl()
  const supabase = publicClient()

  const [videos, categories, tags, models, paysites] = await Promise.all([
    supabase
      .from('videos')
      .select('slug, updated_at, published_at')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(MAX_VIDEOS),
    supabase
      .from('categories')
      .select('slug')
      .eq('is_active', true)
      .order('sort_order')
      .limit(MAX_PER_TAXONOMY),
    // Only taxonomy that leads somewhere. An unused tag is an empty page, and
    // empty pages are what a crawler learns to stop coming back for.
    supabase
      .from('tags')
      .select('slug')
      .gt('usage_count', 0)
      .order('usage_count', { ascending: false })
      .limit(MAX_PER_TAXONOMY),
    supabase
      .from('models')
      .select('slug')
      .gt('video_count', 0)
      .order('video_count', { ascending: false })
      .limit(MAX_PER_TAXONOMY),
    supabase
      .from('paysites')
      .select('domain')
      .order('domain')
      .limit(MAX_PER_TAXONOMY),
  ])

  const now = new Date()

  const staticPages: MetadataRoute.Sitemap = [
    { url: base, lastModified: now, changeFrequency: 'hourly', priority: 1 },
    { url: `${base}/categories`, changeFrequency: 'weekly', priority: 0.8 },
    { url: `${base}/models`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/networks`, changeFrequency: 'weekly', priority: 0.7 },
    { url: `${base}/tags`, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${base}/legal/terms`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/privacy`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/dmca`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/2257`, changeFrequency: 'yearly', priority: 0.2 },
    { url: `${base}/legal/content-removal`, changeFrequency: 'yearly', priority: 0.2 },
  ]

  const videoPages: MetadataRoute.Sitemap = (videos.data ?? []).map((video) => ({
    url: `${base}/watch/${video.slug}`,
    // updated_at moves when the title, description or tags are edited, which
    // is precisely when a crawler should take another look.
    lastModified: new Date(video.updated_at ?? video.published_at ?? now),
    changeFrequency: 'monthly',
    priority: 0.9,
  }))

  const categoryPages: MetadataRoute.Sitemap = (categories.data ?? []).map((row) => ({
    url: `${base}/category/${row.slug}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  const modelPages: MetadataRoute.Sitemap = (models.data ?? []).map((row) => ({
    url: `${base}/model/${row.slug}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  const networkPages: MetadataRoute.Sitemap = (paysites.data ?? []).map((row) => ({
    url: `${base}/paysite/${row.domain}`,
    changeFrequency: 'weekly',
    priority: 0.6,
  }))

  const tagPages: MetadataRoute.Sitemap = (tags.data ?? []).map((row) => ({
    url: `${base}/tag/${row.slug}`,
    changeFrequency: 'weekly',
    priority: 0.4,
  }))

  return [
    ...staticPages,
    ...videoPages,
    ...categoryPages,
    ...modelPages,
    ...networkPages,
    ...tagPages,
  ]
}
