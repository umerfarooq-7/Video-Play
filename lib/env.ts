import { z } from 'zod'

/**
 * Fail fast on misconfiguration. A missing Supabase key should stop the build,
 * not surface as a confusing 500 on the first database query in production.
 *
 * NEXT_PUBLIC_* values are inlined into the client bundle at build time, so
 * they must be referenced as full literals (process.env.NEXT_PUBLIC_FOO) and
 * never assembled dynamically.
 */
const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({
    error: 'NEXT_PUBLIC_SUPABASE_URL must be your project URL, e.g. https://abc.supabase.co',
  }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(20, { error: 'NEXT_PUBLIC_SUPABASE_ANON_KEY is missing or truncated.' }),
  NEXT_PUBLIC_SITE_URL: z.url().default('http://localhost:3000'),

  /** Server-only. Bypasses RLS — must never be imported into a client component. */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  /** Salt for hashing viewer IP+UA into video_views.viewer_hash. */
  VIEW_HASH_SALT: z.string().min(16).default('dev-only-insecure-salt-change-me'),

  /** Which VideoProvider driver to use. See lib/video/provider.ts. */
  VIDEO_PROVIDER: z.enum(['local', 'bunny', 's3']).default('local'),
  VIDEO_CDN_BASE_URL: z.string().optional(),
  VIDEO_PROVIDER_API_KEY: z.string().optional(),
  VIDEO_PROVIDER_LIBRARY_ID: z.string().optional(),

  /** Absolute path used by the local dev driver for uploaded media. */
  LOCAL_MEDIA_ROOT: z.string().default('./.media'),

  /** Shared secret the transcode worker presents on its callback route. */
  WORKER_CALLBACK_SECRET: z.string().min(16).optional(),
})

const parsed = schema.safeParse({
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  VIEW_HASH_SALT: process.env.VIEW_HASH_SALT,
  VIDEO_PROVIDER: process.env.VIDEO_PROVIDER,
  VIDEO_CDN_BASE_URL: process.env.VIDEO_CDN_BASE_URL,
  VIDEO_PROVIDER_API_KEY: process.env.VIDEO_PROVIDER_API_KEY,
  VIDEO_PROVIDER_LIBRARY_ID: process.env.VIDEO_PROVIDER_LIBRARY_ID,
  LOCAL_MEDIA_ROOT: process.env.LOCAL_MEDIA_ROOT,
  WORKER_CALLBACK_SECRET: process.env.WORKER_CALLBACK_SECRET,
})

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n')
  throw new Error(
    `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env.local and fill it in.`,
  )
}

export const env = parsed.data
