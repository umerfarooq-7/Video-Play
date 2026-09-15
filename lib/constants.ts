/**
 * Values shared between proxy.ts and the app. Kept in their own module so a
 * page importing one of them does not pull the whole proxy into its bundle.
 */

/** Set once the visitor has passed the age wall. */
export const AGE_COOKIE = 'age_ack'
export const AGE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

/** Holds a visitor's manual region override, if they picked one. */
export const REGION_COOKIE = 'site_region'

/** Headers proxy.ts forwards so pages need not redo the geo lookup. */
export const REGION_HEADER = 'x-site-region'
export const COUNTRY_HEADER = 'x-site-country'

/** Upload limits, enforced in both the form and the server action. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024 * 1024 // 8 GB
export const ACCEPTED_VIDEO_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/x-matroska',
  'video/webm',
  'video/x-msvideo',
] as const

/** Longest clip the promo/cutting tool will produce. Mirrors the DB CHECK. */
export const MAX_CLIP_SECONDS = 600

/**
 * Upper bound on how many categories may be submitted for one video.
 *
 * This is a safety rail on an untrusted POST, not a product rule: an uploader
 * is meant to be able to tick every category that genuinely applies, and the
 * picker offers no limit at all. Keep it comfortably above the number of
 * categories the site actually has, or it turns back into the restriction it
 * replaced.
 */
export const MAX_CATEGORIES_PER_VIDEO = 200

/**
 * Longest hover preview. Mirrors the preview_window_valid CHECK on videos.
 * A grid autoplays many of these at once, so length here is bandwidth.
 */
export const MAX_PREVIEW_SECONDS = 30

/** Scenes that may be stitched into one hover promo. Mirrors the DB CHECK. */
export const MAX_PREVIEW_SEGMENTS = 10

/**
 * Link text beneath the player on a network's videos when the admin has set a
 * join link but no wording of their own. `{duration}` is replaced with the
 * full movie's length when the video records one.
 */
export const DEFAULT_DOWNLOAD_TEXT = 'Click Here To Download Full Length Movie'
