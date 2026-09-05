import 'server-only'

import { createHash } from 'node:crypto'
import { env } from '@/lib/env'
import type { VideoProjection } from '@/types/database'

/**
 * Storage/CDN abstraction.
 *
 * Everything above this line stores a `provider` name plus an opaque
 * `provider_asset_id` on the video row and calls through this interface, so
 * the vendor can be changed without touching pages, actions or the worker.
 */

export interface UploadTarget {
  /** Where the browser sends the file. */
  url: string
  method: 'PUT' | 'POST' | 'TUS'
  /**
   * Headers the browser should send. These must never contain a provider API
   * key — anything here is visible in devtools.
   */
  headers: Record<string, string>
  fields?: Record<string, string>
  /** Opaque id to store on the video row. */
  assetId: string
}

export interface AssetMetadata {
  durationSeconds: number | null
  width: number | null
  height: number | null
  sizeBytes: number | null
}

export interface VideoProvider {
  readonly name: string

  /**
   * Reserve an asset slot and hand back a target the browser can upload to
   * directly. Uploads must not proxy through the Next server: a multi-gigabyte
   * file through a serverless function is both a timeout and a bandwidth bill.
   */
  createUploadTarget(input: {
    videoId: string
    filename: string
    contentType: string
    sizeBytes: number
  }): Promise<UploadTarget>

  /**
   * Ask the provider to pull a remote URL itself. Returns null when the
   * provider cannot fetch, in which case our own worker downloads it.
   */
  ingestFromUrl(input: {
    videoId: string
    sourceUrl: string
    title?: string
  }): Promise<{ assetId: string } | null>

  /** Playback URL for an HLS manifest, signed and expiring where supported. */
  getPlaybackUrl(
    path: string,
    options?: { expiresInSeconds?: number; countryCode?: string | null },
  ): Promise<string>

  getThumbnailUrl(path: string | null): string | null

  deleteAsset(assetId: string): Promise<void>

  /**
   * True when the provider transcodes on its own, so our ffmpeg worker should
   * not try to. Bunny does; plain object storage does not.
   */
  readonly transcodesRemotely: boolean
}

/**
 * Resolve a stored path against the configured CDN base.
 *
 * Tolerates a base entered without a scheme ("vz-abc.b-cdn.net"), which is how
 * Bunny displays the hostname in its dashboard and therefore how it usually
 * gets pasted into configuration.
 */
function toPublicUrl(path: string | null): string | null {
  if (!path) return null
  if (path.startsWith('http://') || path.startsWith('https://')) return path

  let base = (env.VIDEO_CDN_BASE_URL ?? '').replace(/\/$/, '')
  if (base && !base.startsWith('/') && !/^https?:\/\//.test(base)) {
    base = `https://${base}`
  }

  const suffix = path.startsWith('/') ? path : `/${path}`
  return `${base}${suffix}`
}

// ---------------------------------------------------------------------------
// local - development driver. Files land under LOCAL_MEDIA_ROOT and are served
// by the /media route handler. ffmpeg runs on this machine via the worker.
// ---------------------------------------------------------------------------

class LocalProvider implements VideoProvider {
  readonly name = 'local'
  readonly transcodesRemotely = false

  /**
   * Local media is always served by the /media route on this origin.
   *
   * Deliberately does NOT read VIDEO_CDN_BASE_URL: after switching the site to
   * a hosted provider that variable points at the vendor's CDN, and older
   * local videos would then resolve to a host that has never seen them.
   */
  private url(path: string | null): string | null {
    if (!path) return null
    if (path.startsWith('http://') || path.startsWith('https://')) return path
    return `/media${path.startsWith('/') ? path : `/${path}`}`
  }

  async createUploadTarget(input: {
    videoId: string
    filename: string
    contentType: string
  }): Promise<UploadTarget> {
    const extension = input.filename.split('.').pop()?.toLowerCase() ?? 'mp4'
    const assetId = `${input.videoId}/source.${extension}`

    return {
      url: `/api/upload/${assetId}`,
      method: 'PUT',
      headers: { 'content-type': input.contentType },
      assetId,
    }
  }

  async ingestFromUrl() {
    // No remote-fetch capability; the worker does the download.
    return null
  }

  async getPlaybackUrl(path: string) {
    return this.url(path) ?? ''
  }

  getThumbnailUrl(path: string | null) {
    return this.url(path)
  }

  async deleteAsset() {
    // The worker owns disk cleanup for the local driver.
  }
}

// ---------------------------------------------------------------------------
// bunny - Bunny Stream.
//
// Bunny stores, transcodes and delivers, so our ffmpeg worker sits out the
// upload and import paths entirely. It is still needed for the clip tool,
// which has to cut frames locally.
//
// Bunny's AUP permits adult content, which rules most competitors out for this
// project. See docs/COMPLIANCE.md.
// ---------------------------------------------------------------------------

const BUNNY_API = 'https://video.bunnycdn.com'

class BunnyProvider implements VideoProvider {
  readonly name = 'bunny'
  readonly transcodesRemotely = true

  private get libraryId(): string {
    const id = env.VIDEO_PROVIDER_LIBRARY_ID
    if (!id) throw new Error('VIDEO_PROVIDER_LIBRARY_ID is required for the bunny provider.')
    return id
  }

  private get apiKey(): string {
    const key = env.VIDEO_PROVIDER_API_KEY
    if (!key) throw new Error('VIDEO_PROVIDER_API_KEY is required for the bunny provider.')
    return key
  }

  /** Create the Bunny video record and return its GUID. */
  private async createVideo(title: string): Promise<string> {
    const response = await fetch(`${BUNNY_API}/library/${this.libraryId}/videos`, {
      method: 'POST',
      headers: {
        AccessKey: this.apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title: title.slice(0, 200) }),
    })

    if (!response.ok) {
      throw new Error(
        `Bunny createVideo failed: ${response.status} ${await response.text()}`,
      )
    }

    const { guid } = (await response.json()) as { guid: string }
    if (!guid) throw new Error('Bunny createVideo returned no guid.')
    return guid
  }

  /**
   * Presigned TUS upload.
   *
   * This is the whole reason the browser never sees the API key. Bunny accepts
   * a signature computed as SHA256(libraryId + apiKey + expiry + videoId); we
   * compute it here on the server and hand the browser only the signature,
   * which is scoped to one video and expires. A leaked signature can upload to
   * that one video until it expires — a leaked API key can delete the library.
   */
  async createUploadTarget(input: {
    videoId: string
    filename: string
  }): Promise<UploadTarget> {
    const guid = await this.createVideo(input.filename)

    // Generous window: an 8 GB upload on a slow connection takes hours.
    const expiry = Date.now() + 24 * 60 * 60 * 1000

    const signature = createHash('sha256')
      .update(`${this.libraryId}${this.apiKey}${expiry}${guid}`)
      .digest('hex')

    return {
      url: `${BUNNY_API}/tusupload`,
      method: 'TUS',
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expiry),
        VideoId: guid,
        LibraryId: this.libraryId,
      },
      assetId: guid,
    }
  }

  /**
   * Hand the URL to Bunny and let it do the downloading. This is the primary
   * path for this project: the client's workflow is paste-a-link, and doing it
   * this way means no bytes ever pass through our own servers.
   */
  async ingestFromUrl(input: { videoId: string; sourceUrl: string; title?: string }) {
    const guid = await this.createVideo(input.title ?? 'Imported video')

    const response = await fetch(
      `${BUNNY_API}/library/${this.libraryId}/videos/${guid}/fetch`,
      {
        method: 'POST',
        headers: {
          AccessKey: this.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ url: input.sourceUrl }),
      },
    )

    if (!response.ok) {
      throw new Error(
        `Bunny fetch failed: ${response.status} ${await response.text()}`,
      )
    }

    return { assetId: guid }
  }

  /** Metadata Bunny worked out during encoding. Called by the webhook. */
  async getAssetDetails(guid: string): Promise<
    AssetMetadata & { thumbnailFileName: string | null; status: number }
  > {
    const response = await fetch(
      `${BUNNY_API}/library/${this.libraryId}/videos/${guid}`,
      { headers: { AccessKey: this.apiKey } },
    )

    if (!response.ok) {
      throw new Error(`Bunny getVideo failed: ${response.status}`)
    }

    const data = (await response.json()) as {
      length?: number
      width?: number
      height?: number
      storageSize?: number
      thumbnailFileName?: string
      status?: number
    }

    return {
      durationSeconds: data.length ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      sizeBytes: data.storageSize ?? null,
      thumbnailFileName: data.thumbnailFileName ?? null,
      status: data.status ?? 0,
    }
  }

  /**
   * Playback URL, optionally token-signed.
   *
   * Token authentication has to be switched on in the Bunny library settings
   * first, and it uses a separate security key from the API key. It is opt-in
   * here (BUNNY_TOKEN_AUTH_KEY) rather than always-on, because turning it on
   * in code while it is off in the dashboard would break every video with a
   * 403 and no obvious cause.
   *
   * Leaving it off means manifests can be hotlinked from other sites at your
   * bandwidth expense — worth enabling before launch.
   */
  async getPlaybackUrl(path: string, options?: { expiresInSeconds?: number }) {
    const url = toPublicUrl(path) ?? ''
    const securityKey = process.env.BUNNY_TOKEN_AUTH_KEY

    if (!securityKey || !url) return url

    const expires = Math.floor(Date.now() / 1000) + (options?.expiresInSeconds ?? 4 * 60 * 60)
    const pathname = new URL(url).pathname

    // Bunny's URL token: base64url of SHA256(securityKey + path + expiry).
    const token = createHash('sha256')
      .update(`${securityKey}${pathname}${expires}`)
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')

    return `${url}?token=${token}&expires=${expires}`
  }

  getThumbnailUrl(path: string | null) {
    return toPublicUrl(path)
  }

  async deleteAsset(assetId: string) {
    await fetch(`${BUNNY_API}/library/${this.libraryId}/videos/${assetId}`, {
      method: 'DELETE',
      headers: { AccessKey: this.apiKey },
    })
  }
}

// ---------------------------------------------------------------------------
// s3 - any S3-compatible object store fronted by a CDN. Transcoding is the
// worker's job; this driver only moves and addresses bytes.
// ---------------------------------------------------------------------------

class S3Provider implements VideoProvider {
  readonly name = 's3'
  readonly transcodesRemotely = false

  async createUploadTarget(): Promise<UploadTarget> {
    throw new Error(
      'The s3 provider needs a presigned-PUT implementation. Add ' +
        '@aws-sdk/s3-request-presigner and return a presigned URL here.',
    )
  }

  async ingestFromUrl() {
    return null
  }

  async getPlaybackUrl(path: string) {
    return toPublicUrl(path) ?? ''
  }

  getThumbnailUrl(path: string | null) {
    return toPublicUrl(path)
  }

  async deleteAsset() {
    throw new Error('The s3 provider needs a DeleteObject implementation.')
  }
}

const instances = new Map<string, VideoProvider>()

function build(name: string): VideoProvider {
  switch (name) {
    case 'bunny':
      return new BunnyProvider()
    case 's3':
      return new S3Provider()
    default:
      return new LocalProvider()
  }
}

/**
 * The provider new uploads should go to. Driven by VIDEO_PROVIDER.
 */
export function getVideoProvider(): VideoProvider {
  return getProviderFor(env.VIDEO_PROVIDER)
}

/**
 * The provider that owns an *existing* video's bytes.
 *
 * Always use this when resolving a URL from a video row, passing that row's
 * own `provider` column. Videos uploaded before a provider switch still live
 * where they were put; resolving them through the newly configured provider
 * would point every old thumbnail and manifest at a CDN that has never heard
 * of them.
 */
export function getProviderFor(name: string | null | undefined): VideoProvider {
  const key = name || 'local'
  let instance = instances.get(key)

  if (!instance) {
    instance = build(key)
    instances.set(key, instance)
  }

  return instance
}

/** Narrowed accessor for the webhook, which needs Bunny-specific calls. */
export function getBunnyProvider(): BunnyProvider {
  return new BunnyProvider()
}

/** Paths Bunny serves for a given video GUID. */
export const bunnyPaths = {
  playlist: (guid: string) => `${guid}/playlist.m3u8`,
  thumbnail: (guid: string, fileName = 'thumbnail.jpg') => `${guid}/${fileName}`,
  /**
   * Animated hover preview. Bunny generates this during encoding, so the
   * "short clip on hover" the client asked for needs no cutting of our own.
   */
  preview: (guid: string) => `${guid}/preview.webp`,
  /** The source file Bunny retains, used for direct downloads. */
  original: (guid: string) => `${guid}/original`,
}

/**
 * Resolve any stored media path against the owning provider's public base.
 *
 * Thin wrapper over the provider's URL resolution, for callers that hold a
 * path and a provider name but have no reason to care which driver is which.
 */
export function publicAssetUrl(
  providerName: string | null | undefined,
  path: string | null,
): string | null {
  return getProviderFor(providerName).getThumbnailUrl(path)
}

/** Projections the VR/360 renderer handles, as opposed to the flat player. */
export function isImmersive(projection: VideoProjection): boolean {
  return projection !== 'flat'
}
