'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/guards'
import { uploadAdFile, removeAdFile } from '@/lib/admin/ad-upload'
import { AD_PLACEMENTS, AD_KINDS } from '@/types/database'
import type { CatalogState } from '@/lib/admin/catalog-actions'

export type { CatalogState }

// Imported rather than restated: see the note on AD_PLACEMENTS.
const PLACEMENTS = AD_PLACEMENTS
const KINDS = AD_KINDS

/**
 * Only http(s). These values are written into `src` and `href` attributes on
 * public pages, so a `javascript:` URL pasted here would run in every
 * visitor's browser. The same rule is a CHECK constraint on the table, because
 * this form is not the only thing that can reach the column.
 */
const httpUrl = z
  .union([z.url(), z.literal('')])
  .optional()
  .refine((v) => !v || /^https?:\/\//.test(v), {
    error: 'Links must start with http:// or https://',
  })

const adSchema = z
  .object({
    id: z.uuid().optional(),
    name: z
      .string()
      .trim()
      .min(2, { error: 'Give the ad a name so you can recognise it later.' })
      .max(80),
    placement: z.enum(PLACEMENTS),
    kind: z.enum(KINDS),
    imageUrl: httpUrl,
    targetUrl: httpUrl,
    videoUrl: httpUrl,
    // An ad network's snippet. Stored verbatim and rendered inside a sandboxed
    // iframe; see components/ads/AdSlot.tsx for why that frame is the only
    // place third-party script is allowed to run.
    htmlCode: z.string().trim().max(10_000).optional(),
    width: z.coerce.number().int().min(40).max(2000).optional(),
    height: z.coerce.number().int().min(40).max(2000).optional(),
    skipAfterSeconds: z.coerce.number().int().min(0).max(60).optional(),
    sortOrder: z.coerce.number().int().min(0).max(999).optional(),
    isActive: z.boolean().optional(),
    startsAt: z.union([z.iso.datetime({ local: true }), z.literal('')]).optional(),
    endsAt: z.union([z.iso.datetime({ local: true }), z.literal('')]).optional(),
  })
  // The database rejects these too, but a constraint violation comes back as
  // "ads_ad_has_creative" — true, and useless to whoever is filling the form.
  .refine((v) => v.kind !== 'image' || !!v.imageUrl, {
    error: 'An image ad needs an image link.',
    path: ['imageUrl'],
  })
  .refine((v) => v.kind !== 'html' || !!v.htmlCode, {
    error: 'Paste the code your ad network gave you.',
    path: ['htmlCode'],
  })
  .refine((v) => v.kind !== 'html' || !!v.height, {
    error: 'An ad network block needs a height, or the frame has none.',
    path: ['height'],
  })
  .refine((v) => v.kind !== 'video' || !!v.videoUrl, {
    error: 'A pre-roll needs a link to the video file.',
    path: ['videoUrl'],
  })
  // One way only: a pre-roll is always a video, but a video is no longer
  // only ever a pre-roll — a banner slot can hold one in place of a GIF.
  .refine((v) => v.placement !== 'preroll' || v.kind === 'video', {
    error: 'An ad before the video has to be a video.',
    path: ['kind'],
  })

export async function saveAd(_prev: CatalogState, formData: FormData): Promise<CatalogState> {
  await requireAdmin('/admin/ads')

  // A chosen file wins over anything in the matching URL box, and is resolved
  // to a URL before validation so the rest of the schema does not need to know
  // which of the two the creative arrived as.
  const uploaded = await takeUploads(formData)
  if ('error' in uploaded) return { fieldErrors: uploaded.error }

  const parsed = adSchema.safeParse({
    id: formData.get('id') || undefined,
    name: formData.get('name'),
    placement: formData.get('placement'),
    kind: formData.get('kind'),
    imageUrl: uploaded.imageUrl ?? formData.get('imageUrl') ?? undefined,
    targetUrl: formData.get('targetUrl') || undefined,
    videoUrl: uploaded.videoUrl ?? formData.get('videoUrl') ?? undefined,
    htmlCode: formData.get('htmlCode') || undefined,
    width: formData.get('width') || undefined,
    height: formData.get('height') || undefined,
    skipAfterSeconds: formData.get('skipAfterSeconds') || undefined,
    sortOrder: formData.get('sortOrder') || undefined,
    isActive: formData.get('isActive') === 'on',
    startsAt: formData.get('startsAt') || undefined,
    endsAt: formData.get('endsAt') || undefined,
  })

  if (!parsed.success) {
    // The file had to be uploaded before validation, because validation is
    // what checks the creative is there — but a form that then fails would
    // otherwise leave it in storage with no ad pointing at it. That is how
    // four orphans accumulated while a bad placement was rejecting every save.
    await removeAdFile(uploaded.imageUrl)
    await removeAdFile(uploaded.videoUrl)
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const d = parsed.data
  const supabase = await createClient()

  // What the ad used to point at, so a creative this edit replaces can be
  // cleared out of storage instead of lingering there unreferenced.
  const previous = d.id
    ? (await supabase.from('ads').select('image_url, video_url').eq('id', d.id).maybeSingle())
        .data
    : null

  // Only the fields the chosen kind uses are written. Without this, switching
  // an ad from an image to a snippet would leave the old image URL behind and
  // the CHECK constraints would start disagreeing with what the form shows.
  const values = {
    name: d.name,
    placement: d.placement,
    kind: d.kind,
    image_url: d.kind === 'image' ? d.imageUrl || null : null,
    html_code: d.kind === 'html' ? d.htmlCode || null : null,
    video_url: d.kind === 'video' ? d.videoUrl || null : null,
    target_url: d.targetUrl || null,
    width: d.width ?? null,
    height: d.height ?? null,
    skip_after_seconds: d.skipAfterSeconds ?? 5,
    sort_order: d.sortOrder ?? 0,
    is_active: d.isActive ?? false,
    starts_at: d.startsAt ? new Date(d.startsAt).toISOString() : null,
    ends_at: d.endsAt ? new Date(d.endsAt).toISOString() : null,
  }

  const { error } = d.id
    ? await supabase.from('ads').update(values).eq('id', d.id)
    : await supabase.from('ads').insert(values)

  if (error) {
    // Same reasoning as the validation failure above: nothing references the
    // file now, so it should not stay in storage.
    await removeAdFile(uploaded.imageUrl)
    await removeAdFile(uploaded.videoUrl)
    return { error: error.message }
  }

  if (previous) {
    if (previous.image_url && previous.image_url !== values.image_url) {
      await removeAdFile(previous.image_url)
    }
    if (previous.video_url && previous.video_url !== values.video_url) {
      await removeAdFile(previous.video_url)
    }
  }

  revalidateAdSurfaces()
  return { success: d.id ? 'Ad saved.' : 'Ad added.' }
}

/**
 * Upload whichever creative files came with the form.
 *
 * Returns field errors rather than throwing, so a rejected file lands next to
 * the input that produced it instead of as a banner at the top of the page.
 */
async function takeUploads(
  formData: FormData,
): Promise<
  { imageUrl: string | null; videoUrl: string | null } | { error: Record<string, string[]> }
> {
  const image = formData.get('imageFile')
  const video = formData.get('videoFile')

  let imageUrl: string | null = null
  let videoUrl: string | null = null

  if (image instanceof File && image.size > 0) {
    const result = await uploadAdFile(image, 'image')
    if ('error' in result) return { error: { imageFile: [result.error] } }
    imageUrl = result.url
  }

  if (video instanceof File && video.size > 0) {
    const result = await uploadAdFile(video, 'video')
    if ('error' in result) return { error: { videoFile: [result.error] } }
    videoUrl = result.url
  }

  return { imageUrl, videoUrl }
}

export async function deleteAd(_prev: CatalogState, formData: FormData): Promise<CatalogState> {
  await requireAdmin('/admin/ads')

  const id = String(formData.get('id') ?? '')
  if (!id) return { error: 'Missing ad.' }

  const supabase = await createClient()

  const { data: doomed } = await supabase
    .from('ads')
    .select('image_url, video_url')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('ads').delete().eq('id', id)
  if (error) return { error: error.message }

  // Only after the row is gone: a file removed first would leave a live ad
  // pointing at nothing if the delete then failed.
  await removeAdFile(doomed?.image_url)
  await removeAdFile(doomed?.video_url)

  revalidateAdSurfaces()
  return { success: 'Ad deleted.' }
}

const settingsSchema = z.object({
  homeBannerPosition: z.enum(['top', 'interval']),
  homeGridInterval: z.coerce
    .number()
    .int()
    .min(6, { error: 'Fewer than 6 videos between banners is more advert than site.' })
    .max(100, { error: 'More than 100 and the banner is never reached.' }),
})

export async function saveAdSettings(
  _prev: CatalogState,
  formData: FormData,
): Promise<CatalogState> {
  await requireAdmin('/admin/ads')

  const parsed = settingsSchema.safeParse({
    homeBannerPosition: formData.get('homeBannerPosition') || 'top',
    homeGridInterval: formData.get('homeGridInterval'),
  })

  if (!parsed.success) {
    return { fieldErrors: z.flattenError(parsed.error).fieldErrors }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from('ad_settings')
    .update({
      home_banner_position: parsed.data.homeBannerPosition,
      home_grid_interval: parsed.data.homeGridInterval,
    })
    .eq('id', true)

  if (error) return { error: error.message }

  revalidateAdSurfaces()
  return { success: 'Saved.' }
}

/** Every page an ad can appear on, so a change shows up without a rebuild. */
function revalidateAdSurfaces() {
  revalidatePath('/admin/ads')
  revalidatePath('/')
  // Every watch page at once. The literal route pattern is what invalidates
  // the whole dynamic segment; a concrete slug would clear one video only, and
  // an ad change affects all of them.
  revalidatePath('/watch/[slug]', 'page')
}
