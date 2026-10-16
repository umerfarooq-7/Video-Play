import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Creative files the ad bucket accepts, and the extension each is stored with.
 *
 * An allowlist rather than a blocklist, and it is the browser's claimed type
 * that is checked against it — the same list is set on the bucket itself in
 * migration 0012, so a file that lies about its type is refused by storage
 * even if it gets past here. HTML and SVG are absent on purpose: the bucket is
 * public and served from a real origin, so an uploaded document would be
 * stored XSS.
 */
const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const VIDEO_TYPES = ['video/mp4', 'video/webm']

/** 50 MB, matching the bucket's own limit. */
const MAX_BYTES = 50 * 1024 * 1024

export type UploadResult = { url: string } | { error: string }

/**
 * Put a creative in the public `ads` bucket and hand back its URL.
 *
 * Uses the service role, so it is not subject to RLS — every caller must have
 * already established that the person is an admin.
 */
export async function uploadAdFile(
  file: File,
  expecting: 'image' | 'video',
): Promise<UploadResult> {
  if (file.size === 0) return { error: 'That file is empty.' }
  if (file.size > MAX_BYTES) {
    return { error: `That file is ${mb(file.size)} MB. The limit is 50 MB.` }
  }

  const extension = ALLOWED[file.type]
  const wanted = expecting === 'image' ? IMAGE_TYPES : VIDEO_TYPES

  if (!extension || !wanted.includes(file.type)) {
    return {
      error:
        expecting === 'image'
          ? 'Upload a JPG, PNG, GIF or WebP image.'
          : 'Upload an MP4 or WebM video.',
    }
  }

  // The stored name is generated, never taken from the upload. A name chosen
  // by whoever supplied the creative could collide with an existing file or
  // carry path segments of its own.
  const name = `${Date.now()}-${crypto.randomUUID()}.${extension}`

  const supabase = createAdminClient()
  const { error } = await supabase.storage
    .from('ads')
    .upload(name, file, { contentType: file.type, cacheControl: '31536000' })

  if (error) {
    return {
      error: error.message.toLowerCase().includes('bucket')
        ? 'The ads storage bucket is missing — run migration 0012 in Supabase.'
        : `Upload failed: ${error.message}`,
    }
  }

  const { data } = supabase.storage.from('ads').getPublicUrl(name)
  return { url: data.publicUrl }
}

function mb(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1)
}

/**
 * Delete a creative we uploaded, when its ad is replaced or removed.
 *
 * Only touches URLs that point into our own bucket — a link the admin typed
 * to somebody else's CDN is not ours to tidy up. Failure is ignored: an
 * orphaned file is a few hundred kilobytes, while an error here would block
 * the edit the admin actually asked for.
 */
export async function removeAdFile(url: string | null | undefined) {
  if (!url) return

  const marker = '/storage/v1/object/public/ads/'
  const at = url.indexOf(marker)
  if (at === -1) return

  const name = url.slice(at + marker.length).split('?')[0]
  if (!name) return

  const supabase = createAdminClient()
  await supabase.storage.from('ads').remove([decodeURIComponent(name)])
}
