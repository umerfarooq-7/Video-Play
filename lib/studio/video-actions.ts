'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireProfile, requireUploader } from '@/lib/auth/guards'
import { getVideoProvider } from '@/lib/video/provider'
import { validateRemoteUrl, probeRemoteUrl, UnsafeUrlError } from '@/lib/video/remote-url'
import { slugify } from '@/lib/format'
import {
  MAX_CATEGORIES_PER_VIDEO,
  MAX_CLIP_SECONDS,
  MAX_PREVIEW_SECONDS,
  MAX_PREVIEW_SEGMENTS,
} from '@/lib/constants'
import type { VideoProjection } from '@/types/database'

export type StudioState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: string
  videoId?: string
  /** Where the browser should PUT the file, for the direct-upload flow. */
  upload?: {
    url: string
    method: string
    headers: Record<string, string>
  }
} | null

const PROJECTIONS: VideoProjection[] = [
  'flat',
  'eq360_mono',
  'eq360_stereo_tb',
  'eq180_mono',
  'eq180_stereo_sbs',
]

const metadataSchema = z.object({
  title: z
    .string()
    .trim()
    .min(3, { error: 'Give the video a title of at least 3 characters.' })
    .max(200, { error: 'Titles are limited to 200 characters.' }),
  description: z.string().trim().max(5000).optional(),
  projection: z.enum(PROJECTIONS as [VideoProjection, ...VideoProjection[]]),
  categoryIds: z
    .array(z.uuid())
    .max(MAX_CATEGORIES_PER_VIDEO, {
      error: `Pick at most ${MAX_CATEGORIES_PER_VIDEO} categories.`,
    })
    .optional(),
  tags: z.string().trim().max(500).optional(),

  // --- Sourcing metadata ---------------------------------------------------
  // The paysite is required: attribution is what separates promoting a
  // network's content from simply reposting it, and it is the field a
  // rightsholder will look for first in a takedown dispute.
  paysiteDomain: z
    .string()
    .trim()
    .min(3, { error: 'Enter the paysite domain this video came from.' })
    .max(120)
    .transform((v) =>
      v
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/^www\./, '')
        .replace(/\/.*$/, '')
        .trim(),
    )
    .refine((v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(v), {
      error: 'Enter a bare domain, for example: example.com',
    }),
  models: z.string().trim().max(600).optional(),
  fullDurationSeconds: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 60 * 60)
    .optional(),
  isExclusive: z.boolean().optional(),
  contentOrientation: z.enum(['straight', 'gay', 'shemale']),
  contentHeat: z.enum(['hardcore', 'softcore']),
  producedOn: z
    .union([z.iso.date(), z.literal('')])
    .optional(),

  // Chosen in the browser before upload, from the local file.
  previewStartSeconds: z.coerce.number().min(0).optional(),
  previewEndSeconds: z.coerce.number().min(0).optional(),
  // The moment the cover still is taken from. The provider cuts it during
  // encoding, so this travels no further than the upload target.
  thumbnailTimeSeconds: z.coerce.number().min(0).optional(),
  // JSON array of scenes stitched into the promo. Parsed and re-validated
  // here rather than trusted: the worker feeds these straight into an ffmpeg
  // filter graph, where a malformed entry becomes a broken command.
  previewSegments: z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return null
      try {
        const parsed: unknown = JSON.parse(raw)
        if (!Array.isArray(parsed)) return null

        const clean = parsed
          .filter(
            (s): s is { start: number; end: number } =>
              !!s &&
              typeof s === 'object' &&
              typeof (s as { start?: unknown }).start === 'number' &&
              typeof (s as { end?: unknown }).end === 'number',
          )
          .filter((s) => s.end > s.start && s.start >= 0 && s.end - s.start <= 15)
          .slice(0, MAX_PREVIEW_SEGMENTS)
          .map((s) => ({
            start: Number(s.start.toFixed(3)),
            end: Number(s.end.toFixed(3)),
          }))

        return clean.length > 0 ? clean : null
      } catch {
        return null
      }
    }),

  rightsAttested: z.literal('on', {
    error: 'You must confirm you hold the rights to this video.',
  }),
  consentAttested: z.literal('on', {
    error: 'You must confirm every performer consented and was 18 or older.',
  }),
})

/**
 * Reserve a unique slug. Titles collide constantly ("Sunset", "Test"), and the
 * slug is a UNIQUE column, so a random tail is added rather than looping on
 * insert failures.
 */
function buildSlug(title: string): string {
  const base = slugify(title) || 'video'
  const tail = Math.random().toString(36).slice(2, 8)
  return `${base}-${tail}`.slice(0, 90).replace(/-+$/, '')
}

function parseTags(raw: string | undefined): string[] {
  if (!raw) return []
  return Array.from(
    new Set(
      raw
        .split(',')
        .map((t) => slugify(t))
        .filter((t) => t.length >= 2 && t.length <= 40),
    ),
  ).slice(0, 20)
}

/** Attach categories and tags to a freshly created video. */
async function attachTaxonomy(
  videoId: string,
  categoryIds: string[],
  tagSlugs: string[],
) {
  const supabase = await createClient()

  if (categoryIds.length > 0) {
    await supabase
      .from('video_categories')
      .insert(categoryIds.map((id) => ({ video_id: videoId, category_id: id })))
  }

  if (tagSlugs.length === 0) return

  // Tags are shared across the site: reuse an existing row when the slug is
  // already known, and only create what is genuinely new.
  const { data: existing } = await supabase
    .from('tags')
    .select('id, slug')
    .in('slug', tagSlugs)

  const known = new Map((existing ?? []).map((t) => [String(t.slug), t.id]))
  const missing = tagSlugs.filter((slug) => !known.has(slug))

  if (missing.length > 0) {
    const { data: created } = await supabase
      .from('tags')
      .insert(missing.map((slug) => ({ slug, name: slug.replace(/-/g, ' ') })))
      .select('id, slug')

    for (const tag of created ?? []) known.set(String(tag.slug), tag.id)
  }

  const links = tagSlugs
    .map((slug) => known.get(slug))
    .filter((id): id is string => !!id)
    .map((tagId) => ({ video_id: videoId, tag_id: tagId }))

  if (links.length > 0) {
    await supabase.from('video_tags').insert(links)
  }
}

/**
 * Normalise the promo window the browser picked.
 *
 * Returns nulls unless the pair is complete and inside the bounds the
 * `preview_window_valid` CHECK enforces — a rejected insert over a cosmetic
 * field would fail the whole upload.
 */
function promoWindow(
  start: number | undefined,
  end: number | undefined,
): { preview_start_seconds: number | null; preview_end_seconds: number | null } {
  const none = { preview_start_seconds: null, preview_end_seconds: null }

  if (start === undefined || end === undefined) return none
  if (!Number.isFinite(start) || !Number.isFinite(end)) return none
  if (end <= start) return none
  if (end - start > MAX_PREVIEW_SECONDS) {
    return {
      preview_start_seconds: Number(start.toFixed(3)),
      preview_end_seconds: Number((start + MAX_PREVIEW_SECONDS).toFixed(3)),
    }
  }

  return {
    preview_start_seconds: Number(start.toFixed(3)),
    preview_end_seconds: Number(end.toFixed(3)),
  }
}

function readMetadata(formData: FormData) {
  return metadataSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    projection: formData.get('projection') || 'flat',
    categoryIds: formData.getAll('categoryIds').map(String).filter(Boolean),
    tags: formData.get('tags') || undefined,
    paysiteDomain: formData.get('paysiteDomain'),
    models: formData.get('models') || undefined,
    fullDurationSeconds: formData.get('fullDurationSeconds') || undefined,
    isExclusive: formData.get('isExclusive') === 'on',
    contentOrientation: formData.get('contentOrientation') || 'straight',
    contentHeat: formData.get('contentHeat') || 'hardcore',
    producedOn: formData.get('producedOn') || undefined,
    previewStartSeconds: formData.get('previewStartSeconds') || undefined,
    previewEndSeconds: formData.get('previewEndSeconds') || undefined,
    previewSegments: formData.get('previewSegments') || undefined,
    thumbnailTimeSeconds: formData.get('thumbnailTimeSeconds') || undefined,
    rightsAttested: formData.get('rightsAttested'),
    consentAttested: formData.get('consentAttested'),
  })
}

/**
 * Find the paysite for a domain, creating an unapproved one if it is new.
 *
 * New paysites are usable immediately but flagged `is_approved = false` so
 * staff can tidy the list later. Blocking an upload behind paysite approval
 * would stall the whole workflow for a one-line piece of metadata.
 */
async function resolvePaysite(domain: string, userId: string): Promise<string | null> {
  const supabase = await createClient()

  const { data: existing } = await supabase
    .from('paysites')
    .select('id')
    .eq('domain', domain)
    .maybeSingle()

  if (existing) return existing.id

  const { data: created, error } = await supabase
    .from('paysites')
    .insert({
      domain,
      // Reasonable default label: "brazzers.com" -> "Brazzers".
      name: domain.split('.')[0].replace(/(^|[-_])(\w)/g, (_m, _s, c) => c.toUpperCase()),
      created_by: userId,
      is_approved: false,
    })
    .select('id')
    .single()

  if (error) {
    // Another upload may have created the same domain a moment ago.
    if (error.code === '23505') {
      const { data: raced } = await supabase
        .from('paysites')
        .select('id')
        .eq('domain', domain)
        .maybeSingle()
      return raced?.id ?? null
    }
    return null
  }

  return created?.id ?? null
}

/** Resolve comma-separated performer names to model rows, creating new ones. */
async function attachModels(videoId: string, raw: string | undefined, userId: string) {
  if (!raw) return

  const names = Array.from(
    new Set(
      raw
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n.length >= 2 && n.length <= 80),
    ),
  ).slice(0, 20)

  if (names.length === 0) return

  const supabase = await createClient()
  const slugs = names.map((n) => slugify(n)).filter(Boolean)

  const { data: existing } = await supabase
    .from('models')
    .select('id, slug')
    .in('slug', slugs)

  const known = new Map((existing ?? []).map((m) => [String(m.slug), m.id]))

  const missing = names.filter((n) => slugify(n) && !known.has(slugify(n)))

  if (missing.length > 0) {
    const { data: created } = await supabase
      .from('models')
      .insert(
        missing.map((name) => ({
          slug: slugify(name),
          name,
          created_by: userId,
          is_approved: false,
        })),
      )
      .select('id, slug')

    for (const model of created ?? []) known.set(String(model.slug), model.id)
  }

  const links = slugs
    .map((slug) => known.get(slug))
    .filter((id): id is string => !!id)
    .map((modelId) => ({ video_id: videoId, model_id: modelId }))

  if (links.length > 0) {
    await supabase.from('video_models').insert(links)
  }
}

// ---------------------------------------------------------------------------
// Direct upload: create the draft, hand back an upload target.
// ---------------------------------------------------------------------------

export async function createUploadDraft(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/upload')

  const parsed = readMetadata(formData)
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const filename = String(formData.get('filename') ?? 'upload.mp4')
  const contentType = String(formData.get('contentType') ?? 'video/mp4')
  const sizeBytes = Number(formData.get('sizeBytes') ?? 0)
  // Full-length source uploaded only so promos can be cut from it.
  const isSourceOnly = formData.get('isSourceOnly') === 'on'

  const supabase = await createClient()
  const provider = getVideoProvider()
  const paysiteId = await resolvePaysite(parsed.data.paysiteDomain, profile.id)

  const { data: video, error } = await supabase
    .from('videos')
    .insert({
      owner_id: profile.id,
      slug: buildSlug(parsed.data.title),
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      projection: parsed.data.projection,
      status: 'draft',
      provider: provider.name,
      rights_attested: true,
      consent_attested: true,
      paysite_id: paysiteId,
      content_orientation: parsed.data.contentOrientation,
      content_heat: parsed.data.contentHeat,
      is_exclusive: parsed.data.isExclusive ?? false,
      produced_on: parsed.data.producedOn || null,
      full_duration_seconds: parsed.data.fullDurationSeconds ?? null,
      is_source_only: isSourceOnly,
      ...promoWindow(parsed.data.previewStartSeconds, parsed.data.previewEndSeconds),
      preview_segments: parsed.data.previewSegments,
    })
    .select('id')
    .single()

  if (error || !video) {
    return { error: `Could not create the video: ${error?.message}` }
  }

  await attachTaxonomy(
    video.id,
    parsed.data.categoryIds ?? [],
    parseTags(parsed.data.tags),
  )
  await attachModels(video.id, parsed.data.models, profile.id)

  const target = await provider.createUploadTarget({
    videoId: video.id,
    filename,
    contentType,
    sizeBytes,
    thumbnailTimeSeconds: parsed.data.thumbnailTimeSeconds,
  })

  await supabase
    .from('videos')
    .update({ provider_asset_id: target.assetId, status: 'uploading' })
    .eq('id', video.id)

  return {
    videoId: video.id,
    upload: { url: target.url, method: target.method, headers: target.headers },
  }
}

/**
 * Called once the browser has finished sending the bytes. Queues the transcode
 * job and moves the video into `processing`.
 */
export async function finalizeUpload(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/upload')

  const videoId = String(formData.get('videoId') ?? '')
  if (!z.uuid().safeParse(videoId).success) {
    return { error: 'Invalid video reference.' }
  }

  const supabase = await createClient()

  // Ownership check: RLS would block a foreign row anyway, but this produces a
  // clear message instead of an empty result.
  const { data: video } = await supabase
    .from('videos')
    .select('id, owner_id, provider_asset_id')
    .eq('id', videoId)
    .maybeSingle()

  if (!video || video.owner_id !== profile.id) {
    return { error: 'Video not found.' }
  }

  const admin = createAdminClient()
  const provider = getVideoProvider()

  // With a provider that transcodes on its own (Bunny), there is nothing for
  // our ffmpeg worker to do. Queueing a job would leave a row nobody ever
  // completes; the provider's webhook moves the video on instead.
  if (!provider.transcodesRemotely) {
    // ingest_jobs has no client insert policy by design, so the queue is
    // written with the service key — after the ownership check above.
    const { error } = await admin.from('ingest_jobs').insert({
      video_id: video.id,
      requested_by: profile.id,
      kind: 'direct_upload',
      source_path: video.provider_asset_id,
      status: 'queued',
    })

    if (error) return { error: `Could not queue processing: ${error.message}` }
  }

  await admin.from('videos').update({ status: 'processing' }).eq('id', video.id)

  revalidatePath('/studio/videos')
  return {
    videoId: video.id,
    success:
      'Upload received. Processing has started — the video goes to a ' +
      'moderator once it finishes.',
  }
}

// ---------------------------------------------------------------------------
// Remote URL import
// ---------------------------------------------------------------------------

export async function importFromUrl(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/import')

  const parsed = readMetadata(formData)
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const rawUrl = String(formData.get('sourceUrl') ?? '')

  // SSRF gate. Never write an unvalidated URL to ingest_jobs — the worker
  // fetches whatever is stored there, from inside our network.
  let validated
  try {
    validated = await validateRemoteUrl(rawUrl)
  } catch (error) {
    if (error instanceof UnsafeUrlError) {
      return { fieldErrors: { sourceUrl: [error.message] } }
    }
    return { error: 'Could not check that link. Try again.' }
  }

  const probe = await probeRemoteUrl(validated.url)
  if (probe.contentType && !/^(video|application\/octet-stream)/.test(probe.contentType)) {
    return {
      fieldErrors: {
        sourceUrl: [
          `That link returns ${probe.contentType}, which does not look like a video file. ` +
            'Use a direct download link, not a page the video is embedded in.',
        ],
      },
    }
  }

  const supabase = await createClient()
  const provider = getVideoProvider()
  const paysiteId = await resolvePaysite(parsed.data.paysiteDomain, profile.id)
  const isSourceOnly = formData.get('isSourceOnly') === 'on'

  const { data: video, error } = await supabase
    .from('videos')
    .insert({
      owner_id: profile.id,
      slug: buildSlug(parsed.data.title),
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      projection: parsed.data.projection,
      status: 'draft',
      provider: provider.name,
      size_bytes: probe.contentLength,
      rights_attested: true,
      consent_attested: true,
      paysite_id: paysiteId,
      content_orientation: parsed.data.contentOrientation,
      content_heat: parsed.data.contentHeat,
      is_exclusive: parsed.data.isExclusive ?? false,
      produced_on: parsed.data.producedOn || null,
      full_duration_seconds: parsed.data.fullDurationSeconds ?? null,
      is_source_only: isSourceOnly,
    })
    .select('id')
    .single()

  if (error || !video) {
    return { error: `Could not create the video: ${error?.message}` }
  }

  await attachTaxonomy(
    video.id,
    parsed.data.categoryIds ?? [],
    parseTags(parsed.data.tags),
  )
  await attachModels(video.id, parsed.data.models, profile.id)

  const admin = createAdminClient()

  // Prefer letting the provider fetch the URL itself: with Bunny the bytes go
  // straight from the source to their network and never touch our server,
  // which removes both the bandwidth cost and the SSRF exposure of doing the
  // download ourselves.
  let remote: { assetId: string } | null = null
  try {
    remote = await provider.ingestFromUrl({
      videoId: video.id,
      sourceUrl: validated.url,
      title: parsed.data.title,
    })
  } catch (ingestError) {
    return {
      error:
        ingestError instanceof Error
          ? `The video host rejected the import: ${ingestError.message}`
          : 'Could not start the import.',
    }
  }

  if (remote) {
    await admin
      .from('videos')
      .update({ provider_asset_id: remote.assetId, status: 'processing' })
      .eq('id', video.id)

    revalidatePath('/studio/videos')
    return {
      videoId: video.id,
      success:
        'Import started. The file is being fetched and encoded; it goes to a ' +
        'moderator once it finishes.',
    }
  }

  // No remote-fetch capability, so our own worker downloads and transcodes it.
  const { error: jobError } = await admin.from('ingest_jobs').insert({
    video_id: video.id,
    requested_by: profile.id,
    kind: 'remote_url',
    source_url: validated.url,
    status: 'queued',
  })

  if (jobError) return { error: `Could not queue the import: ${jobError.message}` }

  await admin.from('videos').update({ status: 'processing' }).eq('id', video.id)

  revalidatePath('/studio/videos')
  return {
    videoId: video.id,
    success:
      'Import queued. The file is being fetched and processed; it goes to a ' +
      'moderator once it finishes.',
  }
}

// ---------------------------------------------------------------------------
// Clip / promo cutting tool
// ---------------------------------------------------------------------------

const clipSchema = z.object({
  sourceVideoId: z.uuid(),
  title: z.string().trim().min(3).max(200),
  startSeconds: z.coerce.number().min(0),
  endSeconds: z.coerce.number().min(0.5),
  isPromo: z.boolean().optional(),
})

export async function createClip(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/clips')

  const parsed = clipSchema.safeParse({
    sourceVideoId: formData.get('sourceVideoId'),
    title: formData.get('title'),
    startSeconds: formData.get('startSeconds'),
    endSeconds: formData.get('endSeconds'),
    isPromo: formData.get('isPromo') === 'on',
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const { sourceVideoId, title, startSeconds, endSeconds, isPromo } = parsed.data

  if (endSeconds <= startSeconds) {
    return { fieldErrors: { endSeconds: ['The end must come after the start.'] } }
  }

  if (endSeconds - startSeconds > MAX_CLIP_SECONDS) {
    return {
      fieldErrors: {
        endSeconds: [`Clips are limited to ${MAX_CLIP_SECONDS / 60} minutes.`],
      },
    }
  }

  const supabase = await createClient()

  const { data: source } = await supabase
    .from('videos')
    .select('id, owner_id, duration_seconds, projection, provider')
    .eq('id', sourceVideoId)
    .maybeSingle()

  if (!source) return { error: 'Source video not found.' }

  // You may only cut from your own material. Allowing clips of anyone's video
  // would turn the tool into a re-upload machine.
  if (source.owner_id !== profile.id) {
    return { error: 'You can only create clips from your own videos.' }
  }

  if (source.duration_seconds && endSeconds > source.duration_seconds) {
    return {
      fieldErrors: {
        endSeconds: ['The end point is past the end of the source video.'],
      },
    }
  }

  // The clip becomes a full video row so it inherits the same player,
  // moderation and search behaviour as anything else.
  const { data: output, error } = await supabase
    .from('videos')
    .insert({
      owner_id: profile.id,
      slug: buildSlug(title),
      title,
      status: 'draft',
      projection: source.projection,
      provider: source.provider,
      rights_attested: true,
      consent_attested: true,
    })
    .select('id')
    .single()

  if (error || !output) {
    return { error: `Could not create the clip: ${error?.message}` }
  }

  const { error: clipError } = await supabase.from('clips').insert({
    source_video_id: sourceVideoId,
    output_video_id: output.id,
    created_by: profile.id,
    title,
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    is_promo: isPromo ?? false,
  })

  if (clipError) return { error: clipError.message }

  const admin = createAdminClient()
  await admin.from('ingest_jobs').insert({
    video_id: output.id,
    requested_by: profile.id,
    kind: 'clip',
    clip_source_id: sourceVideoId,
    clip_start_seconds: startSeconds,
    clip_end_seconds: endSeconds,
    status: 'queued',
  })

  await admin.from('videos').update({ status: 'processing' }).eq('id', output.id)

  revalidatePath('/studio/clips')
  revalidatePath('/studio/videos')

  return { videoId: output.id, success: 'Clip queued for processing.' }
}

// ---------------------------------------------------------------------------
// Ownership management
// ---------------------------------------------------------------------------

export async function submitForReview(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/videos')
  const videoId = String(formData.get('videoId') ?? '')

  if (!z.uuid().safeParse(videoId).success) {
    return { error: 'Invalid video reference.' }
  }

  const supabase = await createClient()

  // The guard_video_status_transitions trigger enforces which moves are legal;
  // this only has to ask for one it permits.
  const { error } = await supabase
    .from('videos')
    .update({ status: 'pending_review' })
    .eq('id', videoId)
    .eq('owner_id', profile.id)

  if (error) return { error: error.message }

  revalidatePath('/studio/videos')
  return { success: 'Sent to moderators for review.' }
}

/**
 * Edit a video's details after it has been uploaded.
 *
 * Staff may edit any video; an uploader only their own. Two things are left
 * alone on purpose:
 *
 *   status — a moderator's call, and the guard_video_status_transitions
 *            trigger would refuse it here anyway.
 *   slug   — a published video's URL is already out in the world, so
 *            retitling must not break every link to it.
 */
export async function updateVideoDetails(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const videoId = String(formData.get('videoId') ?? '')
  if (!z.uuid().safeParse(videoId).success) {
    return { error: 'Invalid video reference.' }
  }

  const profile = await requireProfile('/studio/videos')
  const isStaff = profile.role === 'moderator' || profile.role === 'admin'

  if (!isStaff && profile.uploader_status !== 'approved') {
    return { error: 'Only approved uploaders can edit a video.' }
  }

  const parsed = readMetadata(formData)
  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const paysiteId = await resolvePaysite(parsed.data.paysiteDomain, profile.id)

  // Scope the write to the caller's own rows unless they are staff. RLS
  // enforces the same rule, but filtering here turns a forbidden edit into a
  // clear "not found" instead of a silent no-op.
  let query = supabase
    .from('videos')
    .update({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      projection: parsed.data.projection,
      paysite_id: paysiteId,
      content_orientation: parsed.data.contentOrientation,
      content_heat: parsed.data.contentHeat,
      is_exclusive: parsed.data.isExclusive ?? false,
      produced_on: parsed.data.producedOn || null,
      full_duration_seconds: parsed.data.fullDurationSeconds ?? null,
      is_source_only: formData.get('isSourceOnly') === 'on',
    })
    .eq('id', videoId)

  if (!isStaff) query = query.eq('owner_id', profile.id)

  const { data: video, error } = await query.select('id, slug').single()

  if (error || !video) {
    return { error: error?.message ?? 'That video could not be found.' }
  }

  // Links are replaced wholesale rather than diffed: the form submits the
  // complete set every time, so anything still attached that is not in it was
  // removed by the editor.
  await supabase.from('video_categories').delete().eq('video_id', videoId)
  await supabase.from('video_tags').delete().eq('video_id', videoId)
  await supabase.from('video_models').delete().eq('video_id', videoId)

  await attachTaxonomy(
    videoId,
    parsed.data.categoryIds ?? [],
    parseTags(parsed.data.tags),
  )
  await attachModels(videoId, parsed.data.models, profile.id)

  revalidatePath('/studio/videos')
  revalidatePath('/admin/videos')
  revalidatePath(`/watch/${video.slug}`)
  revalidatePath('/')

  return { success: 'Changes saved.' }
}

export async function deleteVideo(
  _prev: StudioState,
  formData: FormData,
): Promise<StudioState> {
  const profile = await requireUploader('/studio/videos')
  const videoId = String(formData.get('videoId') ?? '')

  if (!z.uuid().safeParse(videoId).success) {
    return { error: 'Invalid video reference.' }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('videos')
    .delete()
    .eq('id', videoId)
    .eq('owner_id', profile.id)

  if (error) return { error: error.message }

  revalidatePath('/studio/videos')
  return { success: 'Video deleted.' }
}
