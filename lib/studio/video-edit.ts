import { createClient } from '@/lib/supabase/server'
import type { VideoMetadataInitial } from '@/components/studio/VideoMetadataFields'
import type { VideoStatus } from '@/types/database'

export interface VideoForEdit {
  id: string
  slug: string
  status: VideoStatus
  ownerId: string
  initial: VideoMetadataInitial
}

/**
 * Read a video back into the shape the metadata form expects.
 *
 * Row-level security already decides who can see what — an uploader only their
 * own rows, staff everything — so no ownership filter is applied here. A video
 * the caller may not touch simply comes back null.
 */
export async function loadVideoForEdit(videoId: string): Promise<VideoForEdit | null> {
  const supabase = await createClient()

  const { data: video } = await supabase
    .from('videos')
    .select(
      `
      id, slug, title, description, status, owner_id, projection,
      content_orientation, content_heat, is_exclusive, is_source_only,
      produced_on, full_duration_seconds,
      paysite:paysites!videos_paysite_id_fkey ( domain )
    `,
    )
    .eq('id', videoId)
    .maybeSingle()

  if (!video) return null

  const [categories, tags, models] = await Promise.all([
    supabase.from('video_categories').select('category_id').eq('video_id', videoId),
    supabase.from('video_tags').select('tags ( slug )').eq('video_id', videoId),
    supabase.from('video_models').select('models ( name )').eq('video_id', videoId),
  ])

  // A one-to-one embed comes back as an object, but PostgREST returns an array
  // when it cannot prove the relationship is unique. Handle both.
  const one = <T,>(value: T | T[] | null): T | null =>
    Array.isArray(value) ? (value[0] ?? null) : value

  const paysite = one(video.paysite as { domain: string } | { domain: string }[] | null)

  return {
    id: video.id,
    slug: video.slug,
    status: video.status as VideoStatus,
    ownerId: video.owner_id,
    initial: {
      title: video.title,
      description: video.description,
      paysiteDomain: paysite?.domain ?? '',
      models: (models.data ?? [])
        .map((row) => one(row.models as { name: string } | { name: string }[] | null)?.name)
        .filter((name): name is string => !!name),
      // The form's tags field is the same comma-separated string it submits.
      tags: (tags.data ?? [])
        .map((row) => one(row.tags as { slug: string } | { slug: string }[] | null)?.slug)
        .filter((slug): slug is string => !!slug)
        .join(', '),
      categoryIds: (categories.data ?? []).map((row) => String(row.category_id)),
      fullDurationSeconds: video.full_duration_seconds,
      contentOrientation: video.content_orientation,
      contentHeat: video.content_heat,
      producedOn: video.produced_on,
      projection: video.projection,
      isExclusive: video.is_exclusive,
      isSourceOnly: video.is_source_only,
    },
  }
}
