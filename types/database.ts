/**
 * Hand-maintained mirror of supabase/migrations/*.sql.
 *
 * Regenerate from a live project instead of editing by hand once the schema
 * settles:
 *   npx supabase gen types typescript --project-id <ref> > types/database.ts
 */

export type UserRole = 'viewer' | 'uploader' | 'moderator' | 'admin'

export type UploaderStatus =
  | 'none'
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'suspended'

export type VideoStatus =
  | 'draft'
  | 'uploading'
  | 'processing'
  | 'pending_review'
  | 'published'
  | 'rejected'
  | 'removed'
  | 'failed'

export type VideoProjection =
  | 'flat'
  | 'eq360_mono'
  | 'eq360_stereo_tb'
  | 'eq180_mono'
  | 'eq180_stereo_sbs'

export type IngestKind = 'direct_upload' | 'remote_url' | 'clip'

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type ReportReason =
  | 'copyright'
  | 'non_consensual'
  | 'csam'
  | 'underage'
  | 'violence'
  | 'spam'
  | 'wrong_category'
  | 'broken'
  | 'other'

export type ReportStatus = 'open' | 'triaged' | 'actioned' | 'dismissed'

export type ContentOrientation = 'straight' | 'gay' | 'shemale'

export type ContentHeat = 'hardcore' | 'softcore'

export type Paysite = {
  id: string
  domain: string
  name: string
  description: string | null
  logo_url: string | null
  is_approved: boolean
  created_by: string | null
  created_at: string
  site_url: string | null
  is_featured: boolean
  video_count: number
}

export type Model = {
  id: string
  slug: string
  name: string
  bio: string | null
  avatar_url: string | null
  is_approved: boolean
  created_by: string | null
  video_count: number
  is_featured: boolean
  created_at: string
}

export type Profile = {
  id: string
  username: string
  display_name: string | null
  bio: string | null
  avatar_url: string | null
  role: UserRole
  uploader_status: UploaderStatus
  country: string | null
  is_banned: boolean
  created_at: string
  updated_at: string
}

export type Category = {
  id: string
  slug: string
  name: string
  description: string | null
  thumbnail_url: string | null
  sort_order: number
  is_active: boolean
  created_at: string
}

export type Tag = {
  id: string
  slug: string
  name: string
  usage_count: number
  created_at: string
}

export type Video = {
  id: string
  owner_id: string
  slug: string
  title: string
  description: string | null
  status: VideoStatus
  projection: VideoProjection
  duration_seconds: number | null
  width: number | null
  height: number | null
  size_bytes: number | null
  provider: string
  provider_asset_id: string | null
  playback_hls_path: string | null
  thumbnail_path: string | null
  preview_sprite_path: string | null
  poster_time_seconds: number | null
  allowed_countries: string[]
  blocked_countries: string[]
  view_count: number
  like_count: number
  dislike_count: number
  moderated_by: string | null
  moderated_at: string | null
  moderation_note: string | null
  rights_attested: boolean
  consent_attested: boolean
  published_at: string | null
  created_at: string
  updated_at: string

  // --- Promo / sourcing metadata (migration 0005) ---
  paysite_id: string | null
  content_orientation: ContentOrientation
  content_heat: ContentHeat
  is_exclusive: boolean
  produced_on: string | null
  /** Length of the original movie this promo was cut from, if known. */
  full_duration_seconds: number | null
  /** A full-length source kept only so promos can be cut from it. Never published. */
  is_source_only: boolean

  // --- Discovery / delivery (migration 0006) ---
  /** Short looping animation for grid hover. Bunny's preview.webp. */
  preview_clip_path: string | null
  /** Directly downloadable file, when the provider exposes one. */
  download_path: string | null
  downloads_enabled: boolean

  // --- Promo window chosen at upload time (migration 0008) ---
  /** Section the uploader picked as the hover preview. Null = use the provider default. */
  preview_start_seconds: number | null
  preview_end_seconds: number | null
  /** Scenes stitched into the hover promo, in play order (migration 0009). */
  preview_segments: { start: number; end: number }[] | null
}

export type UploaderApplication = {
  id: string
  user_id: string
  status: UploaderStatus
  statement: string
  site_url: string | null
  rights_attested: boolean
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  created_at: string
  updated_at: string
}

export type IngestJob = {
  id: string
  video_id: string
  requested_by: string
  kind: IngestKind
  status: JobStatus
  source_url: string | null
  source_path: string | null
  clip_source_id: string | null
  clip_start_seconds: number | null
  clip_end_seconds: number | null
  progress: number
  attempts: number
  max_attempts: number
  locked_by: string | null
  locked_at: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
  created_at: string
  updated_at: string
  /** Cut the hover preview rather than a standalone promo video. */
  is_preview: boolean
}

export type Clip = {
  id: string
  source_video_id: string
  output_video_id: string | null
  created_by: string
  title: string
  start_seconds: number
  end_seconds: number
  is_promo: boolean
  created_at: string
}

export type Report = {
  id: string
  video_id: string
  reporter_id: string | null
  reporter_email: string | null
  reason: ReportReason
  detail: string | null
  status: ReportStatus
  handled_by: string | null
  handled_at: string | null
  resolution: string | null
  created_at: string
  updated_at: string
}

export type VideoRendition = {
  id: string
  video_id: string
  label: string
  height: number
  bitrate_kbps: number | null
  codec: string | null
  path: string
  size_bytes: number | null
  created_at: string
}

/**
 * Shape passed to `createServerClient<Database>` for query type inference.
 *
 * `Relationships` is not optional: postgrest-js's GenericTable requires it, and
 * without it the whole schema fails the constraint and every query result
 * silently infers as `never`. It also drives the typing of embedded selects
 * (`owner:profiles!videos_owner_id_fkey (...)`), so foreign keys used in a
 * select must be declared here.
 */
type Relationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}

type TableDef<
  Row,
  Insert = Partial<Row>,
  Update = Partial<Row>,
  Rels extends Relationship[] = [],
> = {
  Row: Row
  Insert: Insert
  Update: Update
  Relationships: Rels
}

type VideoOwnerRel = [
  {
    foreignKeyName: 'videos_owner_id_fkey'
    columns: ['owner_id']
    isOneToOne: false
    referencedRelation: 'profiles'
    referencedColumns: ['id']
  },
  {
    foreignKeyName: 'videos_paysite_id_fkey'
    columns: ['paysite_id']
    isOneToOne: false
    referencedRelation: 'paysites'
    referencedColumns: ['id']
  },
]

type UploaderApplicationRels = [
  {
    foreignKeyName: 'uploader_applications_user_id_fkey'
    columns: ['user_id']
    isOneToOne: false
    referencedRelation: 'profiles'
    referencedColumns: ['id']
  },
  {
    foreignKeyName: 'uploader_applications_reviewed_by_fkey'
    columns: ['reviewed_by']
    isOneToOne: false
    referencedRelation: 'profiles'
    referencedColumns: ['id']
  },
]

type ReportRels = [
  {
    foreignKeyName: 'reports_video_id_fkey'
    columns: ['video_id']
    isOneToOne: false
    referencedRelation: 'videos'
    referencedColumns: ['id']
  },
  {
    foreignKeyName: 'reports_reporter_id_fkey'
    columns: ['reporter_id']
    isOneToOne: false
    referencedRelation: 'profiles'
    referencedColumns: ['id']
  },
]

type VideoCategoryRels = [
  {
    foreignKeyName: 'video_categories_video_id_fkey'
    columns: ['video_id']
    isOneToOne: false
    referencedRelation: 'videos'
    referencedColumns: ['id']
  },
  {
    foreignKeyName: 'video_categories_category_id_fkey'
    columns: ['category_id']
    isOneToOne: false
    referencedRelation: 'categories'
    referencedColumns: ['id']
  },
]

type VideoTagRels = [
  {
    foreignKeyName: 'video_tags_video_id_fkey'
    columns: ['video_id']
    isOneToOne: false
    referencedRelation: 'videos'
    referencedColumns: ['id']
  },
  {
    foreignKeyName: 'video_tags_tag_id_fkey'
    columns: ['tag_id']
    isOneToOne: false
    referencedRelation: 'tags'
    referencedColumns: ['id']
  },
]

export interface Database {
  public: {
    Tables: {
      profiles: TableDef<Profile>
      categories: TableDef<Category>
      tags: TableDef<Tag>
      videos: TableDef<
        Video,
        Pick<Video, 'owner_id' | 'slug' | 'title'> & Partial<Video>,
        Partial<Video>,
        VideoOwnerRel
      >
      video_categories: TableDef<
        { video_id: string; category_id: string },
        { video_id: string; category_id: string },
        Partial<{ video_id: string; category_id: string }>,
        VideoCategoryRels
      >
      video_tags: TableDef<
        { video_id: string; tag_id: string },
        { video_id: string; tag_id: string },
        Partial<{ video_id: string; tag_id: string }>,
        VideoTagRels
      >
      paysites: TableDef<
        Paysite,
        Pick<Paysite, 'domain' | 'name'> & Partial<Paysite>
      >
      models: TableDef<Model, Pick<Model, 'slug' | 'name'> & Partial<Model>>
      video_models: TableDef<
        { video_id: string; model_id: string },
        { video_id: string; model_id: string },
        Partial<{ video_id: string; model_id: string }>,
        [
          {
            foreignKeyName: 'video_models_video_id_fkey'
            columns: ['video_id']
            isOneToOne: false
            referencedRelation: 'videos'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'video_models_model_id_fkey'
            columns: ['model_id']
            isOneToOne: false
            referencedRelation: 'models'
            referencedColumns: ['id']
          },
        ]
      >
      video_renditions: TableDef<VideoRendition>
      uploader_applications: TableDef<
        UploaderApplication,
        Pick<UploaderApplication, 'user_id' | 'statement'> &
          Partial<UploaderApplication>,
        Partial<UploaderApplication>,
        UploaderApplicationRels
      >
      ingest_jobs: TableDef<
        IngestJob,
        Pick<IngestJob, 'video_id' | 'requested_by' | 'kind'> & Partial<IngestJob>
      >
      clips: TableDef<
        Clip,
        Pick<
          Clip,
          'source_video_id' | 'created_by' | 'title' | 'start_seconds' | 'end_seconds'
        > &
          Partial<Clip>
      >
      video_votes: TableDef<{
        video_id: string
        user_id: string
        value: number
        created_at: string
      }>
      favorites: TableDef<{
        user_id: string
        video_id: string
        created_at: string
      }>
      video_views: TableDef<{
        id: number
        video_id: string
        user_id: string | null
        viewer_hash: string | null
        country: string | null
        watch_seconds: number | null
        created_at: string
      }>
      reports: TableDef<
        Report,
        Pick<Report, 'video_id' | 'reason'> & Partial<Report>,
        Partial<Report>,
        ReportRels
      >
      audit_log: TableDef<{
        id: number
        actor_id: string | null
        action: string
        entity_type: string
        entity_id: string | null
        detail: Record<string, unknown>
        created_at: string
      }>
    }
    Views: Record<never, never>
    Functions: {
      is_staff: { Args: Record<never, never>; Returns: boolean }
      is_admin: { Args: Record<never, never>; Returns: boolean }
      is_approved_uploader: { Args: Record<never, never>; Returns: boolean }
      claim_ingest_job: { Args: { worker_id: string }; Returns: IngestJob }
      record_video_view: {
        Args: {
          p_video_id: string
          p_viewer_hash: string
          p_country?: string | null
          p_user_id?: string | null
        }
        Returns: void
      }
    }
    Enums: {
      user_role: UserRole
      uploader_status: UploaderStatus
      video_status: VideoStatus
      video_projection: VideoProjection
      ingest_kind: IngestKind
      job_status: JobStatus
      report_reason: ReportReason
      report_status: ReportStatus
    }
  }
}
