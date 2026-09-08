-- ============================================================================
-- 0008_promo_window.sql
--
-- Remembers which section of a video the uploader chose as its promo, so the
-- hover preview is that section rather than whatever the CDN generated from
-- the opening seconds.
--
-- Additive and idempotent.
-- ============================================================================

alter table videos
  -- Window the uploader picked while uploading. Null means "no choice made",
  -- and the provider's own generated preview is used instead.
  add column if not exists preview_start_seconds numeric(10,3),
  add column if not exists preview_end_seconds   numeric(10,3);

do $do$ begin
  alter table videos
    add constraint preview_window_valid check (
      (preview_start_seconds is null and preview_end_seconds is null)
      or (
        preview_start_seconds is not null
        and preview_end_seconds is not null
        and preview_end_seconds > preview_start_seconds
        -- A hover preview is a few seconds. Anything longer is a clip, and
        -- would be a large file autoplaying on a grid of cards.
        and preview_end_seconds - preview_start_seconds <= 30
      )
    );
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- The worker needs to tell "cut a standalone promo video" from "cut the hover
-- preview for this video".
--
-- A flag rather than a new ingest_kind value: ALTER TYPE ... ADD VALUE cannot
-- run inside a transaction block, and the Supabase SQL editor wraps whatever
-- you paste into one. A boolean needs no such special handling and re-runs
-- cleanly.
-- ---------------------------------------------------------------------------

alter table ingest_jobs
  add column if not exists is_preview boolean not null default false;

create index if not exists ingest_jobs_preview_idx
  on ingest_jobs(is_preview, status)
  where status in ('queued', 'running');
