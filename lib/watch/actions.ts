'use server'

import { createHash } from 'node:crypto'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import { COUNTRY_HEADER } from '@/lib/constants'

export type WatchState = { error?: string; success?: string } | null

/**
 * Stable, non-reversible identifier for an anonymous viewer.
 *
 * Storing raw IP addresses against adult viewing history would be a serious
 * privacy liability (special-category data under UK/EU GDPR). A salted hash
 * gives us the de-duplication we need for view counting without ever holding
 * the address itself. The salt lives in the environment, so the hashes are not
 * reversible via a precomputed table.
 */
async function viewerHash(): Promise<string> {
  const headerList = await headers()

  // x-forwarded-for is a comma-separated chain; the first entry is the client.
  const ip =
    headerList.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    headerList.get('x-real-ip') ||
    'unknown'

  const agent = headerList.get('user-agent') ?? 'unknown'

  return createHash('sha256')
    .update(`${env.VIEW_HASH_SALT}:${ip}:${agent}`)
    .digest('hex')
}

/**
 * Count a view. Called from the watch page.
 *
 * record_video_view() is SECURITY DEFINER and rate-limits to one count per
 * viewer per video per hour, so a refresh loop cannot inflate the number.
 */
export async function recordView(videoId: string): Promise<void> {
  if (!z.uuid().safeParse(videoId).success) return

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const headerList = await headers()
  const country = headerList.get(COUNTRY_HEADER) || null

  try {
    // Uses the service key: the RPC updates videos.view_count, which the
    // guard trigger forbids ordinary users from touching.
    const admin = createAdminClient()
    await admin.rpc('record_video_view', {
      p_video_id: videoId,
      p_viewer_hash: await viewerHash(),
      p_country: country,
      p_user_id: user?.id ?? null,
    })
  } catch (error) {
    // A failed view count must never break playback.
    console.error('[recordView] failed', error)
  }
}

const voteSchema = z.object({
  videoId: z.uuid(),
  value: z.coerce.number().refine((v) => v === 1 || v === -1),
})

export async function voteOnVideo(
  _prev: WatchState,
  formData: FormData,
): Promise<WatchState> {
  const parsed = voteSchema.safeParse({
    videoId: formData.get('videoId'),
    value: formData.get('value'),
  })

  if (!parsed.success) return { error: 'Invalid vote.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Log in to rate videos.' }

  const { data: existing } = await supabase
    .from('video_votes')
    .select('value')
    .eq('video_id', parsed.data.videoId)
    .eq('user_id', user.id)
    .maybeSingle()

  // Clicking the same button again clears the vote, which is what people
  // expect from a toggle.
  if (existing?.value === parsed.data.value) {
    await supabase
      .from('video_votes')
      .delete()
      .eq('video_id', parsed.data.videoId)
      .eq('user_id', user.id)
  } else {
    await supabase.from('video_votes').upsert({
      video_id: parsed.data.videoId,
      user_id: user.id,
      value: parsed.data.value,
    })
  }

  revalidatePath('/watch/[slug]', 'page')
  return { success: 'Thanks for the feedback.' }
}

export async function toggleFavorite(
  _prev: WatchState,
  formData: FormData,
): Promise<WatchState> {
  const videoId = String(formData.get('videoId') ?? '')
  if (!z.uuid().safeParse(videoId).success) return { error: 'Invalid request.' }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return { error: 'Log in to save videos.' }

  const { data: existing } = await supabase
    .from('favorites')
    .select('video_id')
    .eq('video_id', videoId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    await supabase
      .from('favorites')
      .delete()
      .eq('video_id', videoId)
      .eq('user_id', user.id)
    revalidatePath('/watch/[slug]', 'page')
    return { success: 'Removed from your saved videos.' }
  }

  await supabase.from('favorites').insert({ video_id: videoId, user_id: user.id })
  revalidatePath('/watch/[slug]', 'page')
  return { success: 'Saved.' }
}

const reportSchema = z.object({
  videoId: z.uuid(),
  reason: z.enum([
    'copyright',
    'non_consensual',
    'csam',
    'underage',
    'violence',
    'spam',
    'wrong_category',
    'broken',
    'other',
  ]),
  detail: z.string().trim().max(2000).optional(),
  email: z.union([z.email(), z.literal('')]).optional(),
})

/**
 * File a report. Deliberately accepts anonymous submissions — a takedown route
 * that requires an account is not a usable abuse channel, and the people most
 * likely to need it (someone appearing without consent) will not have one.
 */
export async function reportVideo(
  _prev: WatchState,
  formData: FormData,
): Promise<WatchState> {
  const parsed = reportSchema.safeParse({
    videoId: formData.get('videoId'),
    reason: formData.get('reason'),
    detail: formData.get('detail') || undefined,
    email: formData.get('email') || undefined,
  })

  if (!parsed.success) {
    return { error: 'Choose a reason for the report.' }
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { error } = await supabase.from('reports').insert({
    video_id: parsed.data.videoId,
    reporter_id: user?.id ?? null,
    reporter_email: parsed.data.email || null,
    reason: parsed.data.reason,
    detail: parsed.data.detail ?? null,
    status: 'open',
  })

  if (error) return { error: 'Could not file the report. Please try again.' }

  const urgent = ['csam', 'underage', 'non_consensual'].includes(parsed.data.reason)

  return {
    success: urgent
      ? 'Report received and prioritised. Our team reviews these ahead of everything else.'
      : 'Report received. Thank you — our moderators will review it.',
  }
}
