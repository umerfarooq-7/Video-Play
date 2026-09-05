import 'server-only'

import { createClient } from '@/lib/supabase/server'
import { getProviderFor } from '@/lib/video/provider'
import type { Video, VideoProjection } from '@/types/database'

export type SortOption = 'new' | 'views' | 'rating' | 'duration' | 'relevance'

export interface VideoCardData {
  id: string
  slug: string
  title: string
  durationSeconds: number | null
  thumbnailUrl: string | null
  viewCount: number
  likeCount: number
  dislikeCount: number
  projection: VideoProjection
  publishedAt: string | null
  uploader: { username: string; displayName: string | null } | null
  /** Animated preview shown while the pointer is over the card. */
  previewUrl: string | null
}

export interface VideoQuery {
  page?: number
  perPage?: number
  sort?: SortOption
  search?: string
  categorySlug?: string
  tagSlug?: string
  ownerId?: string
  /** ISO country of the viewer, for geo-availability filtering. */
  country?: string | null
  minDurationSeconds?: number
  maxDurationSeconds?: number
  projection?: VideoProjection | 'immersive'
}

const SELECT = `
  id, slug, title, duration_seconds, thumbnail_path, view_count,
  like_count, dislike_count, projection, published_at, allowed_countries,
  blocked_countries, provider, preview_clip_path,
  owner:profiles!videos_owner_id_fkey ( username, display_name )
`

type Row = Pick<
  Video,
  | 'id'
  | 'slug'
  | 'title'
  | 'duration_seconds'
  | 'thumbnail_path'
  | 'view_count'
  | 'like_count'
  | 'dislike_count'
  | 'projection'
  | 'published_at'
  | 'allowed_countries'
  | 'blocked_countries'
  | 'provider'
  | 'preview_clip_path'
> & {
  owner: { username: string; display_name: string | null } | null
}

function toCardData(row: Row): VideoCardData {
  // Resolve through the provider that actually owns this row's bytes, not the
  // one currently configured — otherwise every video uploaded before a
  // provider switch points at a CDN that has never heard of it.
  const provider = getProviderFor(row.provider)
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    durationSeconds: row.duration_seconds,
    thumbnailUrl: provider.getThumbnailUrl(row.thumbnail_path),
    previewUrl: provider.getThumbnailUrl(row.preview_clip_path),
    viewCount: row.view_count,
    likeCount: row.like_count,
    dislikeCount: row.dislike_count,
    projection: row.projection,
    publishedAt: row.published_at,
    uploader: row.owner
      ? { username: row.owner.username, displayName: row.owner.display_name }
      : null,
  }
}

/**
 * The one place the public grid is queried from.
 *
 * Geo-availability is enforced here in SQL rather than by filtering the
 * returned page in JS — filtering after the fact silently shrinks pages and
 * breaks pagination counts, which shows up as "page 3 is half empty".
 */
export async function listVideos(query: VideoQuery = {}): Promise<{
  videos: VideoCardData[]
  total: number
  page: number
  perPage: number
}> {
  const supabase = await createClient()

  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(60, Math.max(1, query.perPage ?? 24))
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  let builder = supabase
    .from('videos')
    .select(SELECT, { count: 'exact' })
    .eq('status', 'published')

  if (query.ownerId) {
    builder = builder.eq('owner_id', query.ownerId)
  }

  if (query.search?.trim()) {
    // websearch_to_tsquery understands quoted phrases and OR, and — unlike
    // plainto_tsquery — does not throw on stray operators typed by a user.
    builder = builder.textSearch('search_vector', query.search.trim(), {
      type: 'websearch',
      config: 'english',
    })
  }

  if (query.country) {
    const code = query.country.toUpperCase()
    // Not blocked, AND (allowlist empty OR contains us).
    builder = builder
      .not('blocked_countries', 'cs', `{${code}}`)
      .or(`allowed_countries.eq.{},allowed_countries.cs.{${code}}`)
  }

  if (query.minDurationSeconds !== undefined) {
    builder = builder.gte('duration_seconds', query.minDurationSeconds)
  }
  if (query.maxDurationSeconds !== undefined) {
    builder = builder.lte('duration_seconds', query.maxDurationSeconds)
  }

  if (query.projection === 'immersive') {
    builder = builder.neq('projection', 'flat')
  } else if (query.projection) {
    builder = builder.eq('projection', query.projection)
  }

  switch (query.sort ?? 'new') {
    case 'views':
      builder = builder.order('view_count', { ascending: false })
      break
    case 'rating':
      builder = builder.order('like_count', { ascending: false })
      break
    case 'duration':
      builder = builder.order('duration_seconds', {
        ascending: false,
        nullsFirst: false,
      })
      break
    case 'relevance':
      // Postgres returns text-search hits in no meaningful order without an
      // explicit rank; recency is the honest fallback here.
      builder = builder.order('published_at', { ascending: false })
      break
    default:
      builder = builder.order('published_at', { ascending: false })
  }

  const { data, error, count } = await builder.range(from, to)

  if (error) {
    throw new Error(`listVideos failed: ${error.message}`)
  }

  return {
    videos: ((data ?? []) as unknown as Row[]).map(toCardData),
    total: count ?? 0,
    page,
    perPage,
  }
}

/** Videos in a category, resolved by slug. */
export async function listVideosByCategory(
  categorySlug: string,
  query: Omit<VideoQuery, 'categorySlug'> = {},
) {
  const supabase = await createClient()

  const { data: category } = await supabase
    .from('categories')
    .select('id')
    .eq('slug', categorySlug)
    .single()

  if (!category) return { videos: [], total: 0, page: 1, perPage: 24 }

  const { data: links } = await supabase
    .from('video_categories')
    .select('video_id')
    .eq('category_id', category.id)

  const ids = (links ?? []).map((l) => l.video_id)
  if (ids.length === 0) return { videos: [], total: 0, page: 1, perPage: 24 }

  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(60, Math.max(1, query.perPage ?? 24))

  const { data, count, error } = await supabase
    .from('videos')
    .select(SELECT, { count: 'exact' })
    .eq('status', 'published')
    .in('id', ids)
    .order('published_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)

  if (error) throw new Error(`listVideosByCategory failed: ${error.message}`)

  return {
    videos: ((data ?? []) as unknown as Row[]).map(toCardData),
    total: count ?? 0,
    page,
    perPage,
  }
}

export async function getCategories() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  return data ?? []
}

/**
 * Videos linked to a set of ids, paged.
 *
 * Shared by the model / paysite / tag browse pages. They all resolve to "these
 * video ids", so the geo filtering, ordering and paging live in one place
 * rather than being copied three times.
 */
async function listVideosByIds(
  ids: string[],
  query: { page?: number; perPage?: number; country?: string | null } = {},
) {
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(60, Math.max(1, query.perPage ?? 24))

  if (ids.length === 0) return { videos: [], total: 0, page, perPage }

  const supabase = await createClient()

  let builder = supabase
    .from('videos')
    .select(SELECT, { count: 'exact' })
    .eq('status', 'published')
    .in('id', ids)

  if (query.country) {
    const code = query.country.toUpperCase()
    builder = builder
      .not('blocked_countries', 'cs', `{${code}}`)
      .or(`allowed_countries.eq.{},allowed_countries.cs.{${code}}`)
  }

  const { data, count, error } = await builder
    .order('published_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)

  if (error) throw new Error(`listVideosByIds failed: ${error.message}`)

  return {
    videos: ((data ?? []) as unknown as Row[]).map(toCardData),
    total: count ?? 0,
    page,
    perPage,
  }
}

/** Everything a given performer appears in. */
export async function listVideosByModel(
  slug: string,
  query: { page?: number; perPage?: number; country?: string | null } = {},
) {
  const supabase = await createClient()

  const { data: model } = await supabase
    .from('models')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (!model) return { model: null, videos: [], total: 0, page: 1, perPage: 24 }

  const { data: links } = await supabase
    .from('video_models')
    .select('video_id')
    .eq('model_id', model.id)

  const result = await listVideosByIds(
    (links ?? []).map((l) => l.video_id),
    query,
  )

  return { model, ...result }
}

/** Everything sourced from a given paysite. */
export async function listVideosByPaysite(
  domain: string,
  query: { page?: number; perPage?: number; country?: string | null } = {},
) {
  const supabase = await createClient()

  const { data: paysite } = await supabase
    .from('paysites')
    .select('*')
    .eq('domain', domain)
    .maybeSingle()

  if (!paysite) return { paysite: null, videos: [], total: 0, page: 1, perPage: 24 }

  // paysite_id is a column on videos, so this needs no join table.
  const page = Math.max(1, query.page ?? 1)
  const perPage = Math.min(60, Math.max(1, query.perPage ?? 24))

  let builder = supabase
    .from('videos')
    .select(SELECT, { count: 'exact' })
    .eq('status', 'published')
    .eq('paysite_id', paysite.id)

  if (query.country) {
    const code = query.country.toUpperCase()
    builder = builder
      .not('blocked_countries', 'cs', `{${code}}`)
      .or(`allowed_countries.eq.{},allowed_countries.cs.{${code}}`)
  }

  const { data, count, error } = await builder
    .order('published_at', { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1)

  if (error) throw new Error(`listVideosByPaysite failed: ${error.message}`)

  return {
    paysite,
    videos: ((data ?? []) as unknown as Row[]).map(toCardData),
    total: count ?? 0,
    page,
    perPage,
  }
}

/** Everything carrying a given tag. */
export async function listVideosByTag(
  slug: string,
  query: { page?: number; perPage?: number; country?: string | null } = {},
) {
  const supabase = await createClient()

  const { data: tag } = await supabase
    .from('tags')
    .select('*')
    .eq('slug', slug)
    .maybeSingle()

  if (!tag) return { tag: null, videos: [], total: 0, page: 1, perPage: 24 }

  const { data: links } = await supabase
    .from('video_tags')
    .select('video_id')
    .eq('tag_id', tag.id)

  const result = await listVideosByIds(
    (links ?? []).map((l) => l.video_id),
    query,
  )

  return { tag, ...result }
}

/**
 * Models for the home page rail.
 *
 * Featured entries appear even with no videos yet: an admin ticking "feature
 * on the home page" is an explicit instruction to show it, and a brand new
 * site has nothing published to count. Everything else has to have earned its
 * place by actually appearing in something.
 */
export async function getFeaturedModels(limit = 18) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('models')
    .select('*')
    .or('is_featured.eq.true,video_count.gt.0')
    .order('is_featured', { ascending: false })
    .order('video_count', { ascending: false })
    .limit(limit)

  return data ?? []
}

/** Paysites for the home page rail. Same rule as models. */
export async function getFeaturedPaysites(limit = 18) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('paysites')
    .select('*')
    .or('is_featured.eq.true,video_count.gt.0')
    .order('is_featured', { ascending: false })
    .order('video_count', { ascending: false })
    .limit(limit)

  return data ?? []
}

/** Paysites for the upload form's autocomplete. Approved ones first. */
export async function getPaysites(limit = 500) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('paysites')
    .select('*')
    .order('is_approved', { ascending: false })
    .order('domain')
    .limit(limit)

  return data ?? []
}

/** Models for the upload form's autocomplete, most-used first. */
export async function getModels(limit = 500) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('models')
    .select('*')
    .order('video_count', { ascending: false })
    .limit(limit)

  return data ?? []
}

export async function getPopularTags(limit = 40) {
  const supabase = await createClient()
  const { data } = await supabase
    .from('tags')
    .select('*')
    .order('usage_count', { ascending: false })
    .limit(limit)

  return data ?? []
}

/** Full detail for a watch page. Returns null when not visible to the caller. */
export async function getVideoBySlug(slug: string) {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('videos')
    .select(
      `
      *,
      owner:profiles!videos_owner_id_fkey ( id, username, display_name, avatar_url ),
      video_categories ( categories ( id, slug, name ) ),
      video_tags ( tags ( id, slug, name ) )
    `,
    )
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  return data
}
