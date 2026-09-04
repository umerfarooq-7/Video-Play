import { NextResponse, type NextRequest } from 'next/server'
import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createClient } from '@/lib/supabase/server'
import { env } from '@/lib/env'
import { MAX_UPLOAD_BYTES } from '@/lib/constants'

/**
 * Receiving endpoint for the `local` video provider (development).
 *
 * In production with a hosted provider the browser uploads straight to the
 * vendor and this route is never called — which is the point of the provider
 * abstraction. Streaming multi-gigabyte files through a Next server is slow,
 * expensive, and on a serverless host simply times out.
 *
 * The upload target is `/api/upload/{videoId}/source.{ext}`.
 */

export const runtime = 'nodejs'
// Never let a CDN or the router cache an upload endpoint.
export const dynamic = 'force-dynamic'

export async function PUT(
  request: NextRequest,
  { params }: RouteContext<'/api/upload/[...path]'>,
) {
  const { path } = await params
  const segments = Array.isArray(path) ? path : [path]

  if (segments.length !== 2) {
    return NextResponse.json({ error: 'Malformed upload path.' }, { status: 400 })
  }

  const [videoId, filename] = segments

  // Path traversal guard. `videoId` must be a UUID and the filename a plain
  // name, so nothing can climb out of the media root.
  if (!/^[0-9a-f-]{36}$/i.test(videoId) || !/^[a-zA-Z0-9._-]{1,100}$/.test(filename)) {
    return NextResponse.json({ error: 'Invalid upload path.' }, { status: 400 })
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  }

  // Only the owner may write to their own video's slot. RLS makes a foreign
  // row invisible, so a miss here is either "not yours" or "does not exist" —
  // both answered identically so the endpoint cannot be used to probe ids.
  const { data: video } = await supabase
    .from('videos')
    .select('id, owner_id, status')
    .eq('id', videoId)
    .maybeSingle()

  if (!video || video.owner_id !== user.id) {
    return NextResponse.json({ error: 'Video not found.' }, { status: 404 })
  }

  if (video.status !== 'uploading' && video.status !== 'draft') {
    return NextResponse.json(
      { error: 'This video is no longer accepting an upload.' },
      { status: 409 },
    )
  }

  const declaredLength = Number(request.headers.get('content-length') ?? 0)
  if (declaredLength > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: 'That file is larger than the 8 GB limit.' },
      { status: 413 },
    )
  }

  if (!request.body) {
    return NextResponse.json({ error: 'Empty upload.' }, { status: 400 })
  }

  // Resolve inside the media root and verify containment, belt-and-braces
  // against the regex checks above.
  const root = resolve(env.LOCAL_MEDIA_ROOT)
  const destination = normalize(join(root, videoId, filename))

  if (!destination.startsWith(root + sep)) {
    return NextResponse.json({ error: 'Invalid upload path.' }, { status: 400 })
  }

  await mkdir(dirname(destination), { recursive: true })

  let written = 0
  const source = Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0])

  // Count bytes as they stream: content-length is client-supplied and a
  // chunked upload may not send one at all, so the cap is enforced here too.
  source.on('data', (chunk: Buffer) => {
    written += chunk.length
    if (written > MAX_UPLOAD_BYTES) {
      source.destroy(new Error('UPLOAD_TOO_LARGE'))
    }
  })

  try {
    await pipeline(source, createWriteStream(destination))
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'UPLOAD_TOO_LARGE'
    return NextResponse.json(
      { error: tooLarge ? 'That file is larger than the 8 GB limit.' : 'Upload failed.' },
      { status: tooLarge ? 413 : 500 },
    )
  }

  await supabase.from('videos').update({ size_bytes: written }).eq('id', videoId)

  return NextResponse.json({ ok: true, bytes: written })
}
