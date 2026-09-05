-- ============================================================================
-- 0006_discovery.sql
--
-- Browse-by-model / paysite / tag, hover previews and direct downloads.
-- Additive and idempotent - safe on an existing database and safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- videos: hover preview + download
-- ---------------------------------------------------------------------------

alter table videos
  -- Short looping animation shown when a visitor hovers a grid card. With
  -- Bunny this is the preview.webp it generates during encoding, so nothing
  -- has to be cut by hand.
  add column if not exists preview_clip_path text,
  -- Path to a directly downloadable file, when the provider exposes one.
  add column if not exists download_path text,
  -- Per-video switch so a moderator can withdraw downloads for a single title
  -- (a rightsholder complaint, a licence that only covers streaming) without
  -- turning the feature off site-wide. On by default, as requested.
  add column if not exists downloads_enabled boolean not null default true;

-- ---------------------------------------------------------------------------
-- paysites / models: the fields the admin panel edits
-- ---------------------------------------------------------------------------

alter table paysites
  -- Full URL to link out to, when it differs from the bare domain.
  add column if not exists site_url text,
  add column if not exists is_featured boolean not null default false,
  add column if not exists video_count int not null default 0;

alter table models
  add column if not exists is_featured boolean not null default false;

create index if not exists paysites_featured_idx on paysites(is_featured, video_count desc);
create index if not exists models_featured_idx on models(is_featured, video_count desc);

-- ---------------------------------------------------------------------------
-- Keep paysites.video_count accurate.
--
-- models.video_count is maintained from the video_models join table, but a
-- paysite is a plain column on videos, so it needs its own trigger covering
-- insert, delete, and the update that moves a video between paysites.
-- ---------------------------------------------------------------------------

create or replace function paysites_recount()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.paysite_id is not null then
      update paysites set video_count = video_count + 1 where id = new.paysite_id;
    end if;

  elsif tg_op = 'DELETE' then
    if old.paysite_id is not null then
      update paysites set video_count = greatest(video_count - 1, 0) where id = old.paysite_id;
    end if;

  elsif tg_op = 'UPDATE' and new.paysite_id is distinct from old.paysite_id then
    if old.paysite_id is not null then
      update paysites set video_count = greatest(video_count - 1, 0) where id = old.paysite_id;
    end if;
    if new.paysite_id is not null then
      update paysites set video_count = video_count + 1 where id = new.paysite_id;
    end if;
  end if;

  return null;
end;
$fn$;

drop trigger if exists videos_paysite_recount on videos;
create trigger videos_paysite_recount
  after insert or delete or update of paysite_id on videos
  for each row execute function paysites_recount();

-- Backfill both counters so existing rows are not stuck at zero.
update paysites p
set video_count = (select count(*) from videos v where v.paysite_id = p.id);

update models m
set video_count = (select count(*) from video_models vm where vm.model_id = m.id);

-- ---------------------------------------------------------------------------
-- Admins manage paysites and models fully; the earlier policies only allowed
-- uploaders to propose them.
-- ---------------------------------------------------------------------------

drop policy if exists paysites_admin_delete on paysites;
create policy paysites_admin_delete on paysites
  for delete using (is_admin());

drop policy if exists models_admin_delete on models;
create policy models_admin_delete on models
  for delete using (is_admin());
