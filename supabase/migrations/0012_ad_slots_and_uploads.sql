-- ============================================================================
-- 0012_ad_slots_and_uploads.sql
--
-- Three things the ad network asked for after seeing the first version:
--
--   1. A banner slot beside the video, in the "Up next" column. Networks sell
--      a 300x250 for exactly that position and told us the mid-grid placement
--      we had was not one they recognise.
--   2. The home-page banner above the videos by default, with the every-N
--      repeat as an option rather than the only behaviour.
--   3. Somewhere to put a creative file, because the client is sent GIFs and
--      MP4s directly and has no CDN of their own to upload them to first.
--
-- Additive and idempotent.
-- ============================================================================

-- A new slot. Deliberately not referenced anywhere else in this file: Postgres
-- allows a value to be added to an enum inside a transaction, but not used in
-- the same one, and this migration may be pasted in as a single batch.
alter type ad_placement add value if not exists 'sidebar';

alter table ad_settings
  -- 'top'      - one banner above the video grids, under the category rail.
  -- 'interval' - repeating every home_grid_interval videos, as before.
  add column if not exists home_banner_position text not null default 'top';

do $do$ begin
  alter table ad_settings
    add constraint ad_settings_banner_position
    check (home_banner_position in ('top', 'interval'));
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- Creative storage
--
-- A public bucket, because an ad creative is served to every visitor and a
-- signed URL would expire in the middle of a campaign. Uploads do not go
-- through RLS at all: only the admin screen writes here, with the service
-- role, after requireAdmin() has already run.
--
-- The MIME allowlist is the real guard. Without it the same form would accept
-- an .html or .svg file, and a public bucket serving attacker-chosen HTML on
-- the project's own domain is a stored XSS vector. Images and video only.
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ads',
  'ads',
  true,
  26214400, -- 25 MB. A pre-roll clip is a few MB; a banner is a few hundred KB.
  array[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'video/mp4', 'video/webm'
  ]
)
on conflict (id) do update
  set public             = true,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
