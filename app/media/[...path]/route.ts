import { NextResponse, type NextRequest } from 'next/server'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { join, normalize, resolve, sep, extname } from 'node:path'
import { Readable } from 'node:stream'
import { env } from '@/lib/env'

/**
 * Serves media for the `local` provider in development. In production the CDN
 * does this and the route is unused.
 *
 * Implements HTTP range requests, which are not optional: without a 206
 * response browsers cannot seek within a video, and Safari refuses to play at
 * all.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CONTENT_TYPES: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.ts': 'video/mp2t',
  '.mp4': 'video/mp4',
  '.m4s': 'video/iso.segment',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.vtt': 'text/vtt',
}

export async function GET(
  request: NextRequest,
  { params }: RouteContext<'/media/[...path]'>,
) {
  const { path } = await params
  const segments = Array.isArray(path) ? path : [path]

  // Reject anything that could climb out of the media root before touching
  // the filesystem.
  if (segments.some((s) => !/^[a-zA-Z0-9._-]+$/.test(s) || s === '..')) {
    return new NextResponse('Not found', { status: 404 })
  }

  const root = resolve(env.LOCAL_MEDIA_ROOT)
  const filePath = normalize(join(root, ...segments))

  if (!filePath.startsWith(root + sep)) {
    return new NextResponse('Not found', { status: 404 })
  }

  let stats
  try {
    stats = await stat(filePath)
    if (!stats.isFile()) throw new Error('not a file')
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  const contentType =
    CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream'

  const headers = new Headers({
    'content-type': contentType,
    'accept-ranges': 'bytes',
    // Manifests change as a video is re-processed; segments never do.
    'cache-control': contentType.includes('mpegurl')
      ? 'no-cache'
      : 'public, max-age=31536000, immutable',
  })

  const range = request.headers.get('range')

  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!match) {
      return new NextResponse('Malformed range', { status: 416 })
    }

    const [, rawStart, rawEnd] = match
    let start = rawStart ? Number(rawStart) : 0
    let end = rawEnd ? Number(rawEnd) : stats.size - 1

    // A suffix range ("bytes=-500") means the LAST 500 bytes.
    if (!rawStart && rawEnd) {
      start = Math.max(0, stats.size - Number(rawEnd))
      end = stats.size - 1
    }

    if (start >= stats.size || end >= stats.size || start > end) {
      return new NextResponse('Range not satisfiable', {
        status: 416,
        headers: { 'content-range': `bytes */${stats.size}` },
      })
    }

    headers.set('content-range', `bytes ${start}-${end}/${stats.size}`)
    headers.set('content-length', String(end - start + 1))

    const stream = Readable.toWeb(
      createReadStream(filePath, { start, end }),
    ) as ReadableStream

    return new NextResponse(stream, { status: 206, headers })
  }

  headers.set('content-length', String(stats.size))
  const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream

  return new NextResponse(stream, { status: 200, headers })
}
