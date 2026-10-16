-- ============================================================================
-- 0013_video_banners.sql
--
-- Two things, both from the same problem: the ad network sends the client a
-- GIF, and a GIF of any length is enormous.
--
--   1. A banner may now be an MP4 or WebM instead of an image. A short clip
--      autoplays muted on a loop and looks exactly like an animated GIF at a
--      fraction of the size — often twenty times smaller.
--   2. The upload ceiling goes from 25 MB to 50 MB, for the cases where it
--      really does have to be the GIF.
--
-- Additive and idempotent.
-- ============================================================================

-- A pre-roll is still always a video. What changes is the other direction: a
-- video is no longer only ever a pre-roll, so a banner slot can hold one too.
-- The old constraint stated both halves as one equality.
alter table ads drop constraint if exists ad_kind_fits_placement;

do $do$ begin
  alter table ads
    add constraint ad_kind_fits_placement
    check (placement <> 'preroll' or kind = 'video');
exception when duplicate_object then null;
end $do$;

update storage.buckets
   set file_size_limit = 52428800 -- 50 MB
 where id = 'ads';
