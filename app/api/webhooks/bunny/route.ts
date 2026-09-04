import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBunnyProvider, bunnyPaths } from '@/lib/video/provider'
import { env } from '@/lib/env'

/**
 * Bunny Stream encoding callback.
 *
 * Without this route nothing ever leaves "Processing": Bunny transcodes on its
 * own schedule and this is the only signal that it finished. Our ffmpeg worker
 * is not involved in the Bunny upload/import path at all.
 *
 * Configure it in the Bunny dashboard under the video library's webhook
 * setting, pointing at:
 *   https://<your-site>/api/webhooks/bunny?secret=<WORKER_CALLBACK_SECRET>
 *
 * Bunny posts { VideoLibraryId, VideoGuid, Status }.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Bunny's encoding status codes. */
const STATUS = {
  QUEUED: 0,
  PROCESSING: 1,
  ENCODING: 2,
  FINISHED: 3,
  RESOLUTION_FINISHED: 4,
  FAILED: 5,
} as const

export async function POST(request: NextRequest) {
  // Bunny does not sign its webhooks, so the shared secret in the query string
  // is the only thing separating this from an open endpoint. The payload is
  // still treated as untrusted below — the authoritative data is re-fetched
  // from Bunny's API rather than taken from the request body.
  const secret = request.nextUrl.searchParams.get('secret')

  if (!env.WORKER_CALLBACK_SECRET || secret !== env.WORKER_CALLBACK_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: { VideoLibraryId?: number | string; VideoGuid?: string; Status?: number }

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed body' }, { status: 400 })
  }

  const guid = payload.VideoGuid
  const status = Number(payload.Status)

  if (!guid) {
    return NextResponse.json({ error: 'Missing VideoGuid' }, { status: 400 })
  }

  // Ignore callbacks for a library that is not ours.
  if (
    env.VIDEO_PROVIDER_LIBRARY_ID &&
    payload.VideoLibraryId !== undefined &&
    String(payload.VideoLibraryId) !== String(env.VIDEO_PROVIDER_LIBRARY_ID)
  ) {
    return NextResponse.json({ ok: true, ignored: 'other library' })
  }

  // Intermediate states are noise; only act on a terminal one.
  if (
    status !== STATUS.FINISHED &&
    status !== STATUS.RESOLUTION_FINISHED &&
    status !== STATUS.FAILED
  ) {
    return NextResponse.json({ ok: true, ignored: `status ${status}` })
  }

  const admin = createAdminClient()

  const { data: video } = await admin
    .from('videos')
    .select('id, status, title')
    .eq('provider_asset_id', guid)
    .maybeSingle()

  if (!video) {
    // Not ours, or created outside this app. Answer 200 so Bunny does not
    // retry a callback we will never be able to act on.
    return NextResponse.json({ ok: true, ignored: 'unknown video' })
  }

  if (status === STATUS.FAILED) {
    await admin.from('videos').update({ status: 'failed' }).eq('id', video.id)
    await admin
      .from('ingest_jobs')
      .update({
        status: 'failed',
        error: 'Bunny reported the encode as failed.',
        finished_at: new Date().toISOString(),
      })
      .eq('video_id', video.id)
      .in('status', ['queued', 'running'])

    return NextResponse.json({ ok: true, result: 'failed' })
  }

  // Already moved on — a second callback for another resolution is normal and
  // must not drag a moderated video back into review.
  if (video.status !== 'processing' && video.status !== 'uploading' && video.status !== 'draft') {
    return NextResponse.json({ ok: true, ignored: `already ${video.status}` })
  }

  let details
  try {
    details = await getBunnyProvider().getAssetDetails(guid)
  } catch (error) {
    console.error('[bunny webhook] could not read video details', error)
    // 500 so Bunny retries — the encode is fine, we just could not read it.
    return NextResponse.json({ error: 'Could not read video details' }, { status: 500 })
  }

  await admin
    .from('videos')
    .update({
      // Straight to moderation, never to published: approval is a human
      // decision and a webhook must not be able to make it.
      status: 'pending_review',
      duration_seconds: details.durationSeconds,
      width: details.width,
      height: details.height,
      size_bytes: details.sizeBytes,
      playback_hls_path: bunnyPaths.playlist(guid),
      thumbnail_path: bunnyPaths.thumbnail(
        guid,
        details.thumbnailFileName ?? 'thumbnail.jpg',
      ),
    })
    .eq('id', video.id)

  await admin
    .from('ingest_jobs')
    .update({
      status: 'succeeded',
      progress: 100,
      finished_at: new Date().toISOString(),
      locked_by: null,
    })
    .eq('video_id', video.id)
    .in('status', ['queued', 'running'])

  return NextResponse.json({ ok: true, result: 'pending_review' })
}

/** Convenience for checking the URL is reachable from the Bunny dashboard. */
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'bunny webhook' })
}
