-- ============================================================================
-- 0003_rls.sql - row level security
--
-- Every table is deny-by-default. The anon and authenticated roles reach the
-- database only through these policies, so a bug in a page or route handler
-- still cannot leak an unpublished video or another user's records.
--
-- The service_role key bypasses RLS entirely; it is used only by the transcode
-- worker and by server actions that have already checked authorisation.
-- ============================================================================

alter table profiles              enable row level security;
alter table uploader_applications enable row level security;
alter table categories            enable row level security;
alter table tags                  enable row level security;
alter table videos                enable row level security;
alter table video_categories      enable row level security;
alter table video_tags            enable row level security;
alter table video_renditions      enable row level security;
alter table ingest_jobs           enable row level security;
alter table clips                 enable row level security;
alter table video_votes           enable row level security;
alter table favorites             enable row level security;
alter table video_views           enable row level security;
alter table reports               enable row level security;
alter table audit_log             enable row level security;

-- ---------------------------------------------------------------------------
-- Visibility helper: is this video readable by the caller?
-- Published videos are public. Owners always see their own. Staff see all.
-- ---------------------------------------------------------------------------

create or replace function can_read_video(v_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (
    select 1 from videos v
    where v.id = v_id
      and (
        v.status = 'published'
        or v.owner_id = auth.uid()
        or is_staff()
      )
  );
$fn$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

-- Profile pages are public, so the row is readable; the table deliberately
-- holds no email or auth data (those stay in auth.users, which is not exposed).
drop policy if exists profiles_public_read on profiles;
create policy profiles_public_read on profiles
  for select using (true);

drop policy if exists profiles_update_own on profiles;
create policy profiles_update_own on profiles
  for update using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists profiles_staff_read on profiles;
create policy profiles_staff_read on profiles
  for select using (is_staff());

drop policy if exists profiles_admin_write on profiles;
create policy profiles_admin_write on profiles
  for update using (is_admin()) with check (is_admin());

-- Note: role and uploader_status must not be self-editable. RLS cannot pin a
-- single column, so the guard is a trigger.
create or replace function guard_profile_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  -- Trusted, non-browser contexts (see the reasoning above).
  if auth.uid() is null or is_admin() then
    return new;
  end if;

  -- `role` and `is_banned` are never self-editable, full stop.
  if new.role is distinct from old.role
     or new.is_banned is distinct from old.is_banned then
    raise exception 'Not permitted to modify privilege columns';
  end if;

  -- uploader_status is admin-controlled with exactly one exception: a user
  -- may put themselves into 'pending' by applying. That grants no privilege
  -- of its own — only a moderator can move 'pending' to 'approved'.
  if new.uploader_status is distinct from old.uploader_status then
    if not (
      new.id = auth.uid()
      and old.uploader_status in ('none', 'rejected')
      and new.uploader_status = 'pending'
    ) then
      raise exception 'Not permitted to modify uploader status';
    end if;
  end if;

  return new;
end;
$fn$;

drop trigger if exists profiles_guard_privileges on profiles;
create trigger profiles_guard_privileges
  before update on profiles
  for each row execute function guard_profile_privilege_columns();

-- ---------------------------------------------------------------------------
-- uploader_applications
-- ---------------------------------------------------------------------------

drop policy if exists applications_read_own on uploader_applications;
create policy applications_read_own on uploader_applications
  for select using (user_id = auth.uid() or is_staff());

drop policy if exists applications_insert_own on uploader_applications;
create policy applications_insert_own on uploader_applications
  for insert with check (user_id = auth.uid());

drop policy if exists applications_staff_update on uploader_applications;
create policy applications_staff_update on uploader_applications
  for update using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- Taxonomy: readable by everyone, writable by admins.
-- ---------------------------------------------------------------------------

drop policy if exists categories_public_read on categories;
create policy categories_public_read on categories
  for select using (is_active or is_staff());

drop policy if exists categories_admin_write on categories;
create policy categories_admin_write on categories
  for all using (is_admin()) with check (is_admin());

drop policy if exists tags_public_read on tags;
create policy tags_public_read on tags
  for select using (true);

drop policy if exists tags_staff_write on tags;
create policy tags_staff_write on tags
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------

drop policy if exists videos_public_read on videos;
create policy videos_public_read on videos
  for select using (status = 'published' or owner_id = auth.uid() or is_staff());

-- Only approved uploaders may create, and only as themselves. New rows are
-- forced to start life as a draft: publishing is a moderator action.
drop policy if exists videos_insert_approved on videos;
create policy videos_insert_approved on videos
  for insert with check (
    owner_id = auth.uid()
    and is_approved_uploader()
    and status = 'draft'
  );

drop policy if exists videos_update_own on videos;
create policy videos_update_own on videos
  for update using (owner_id = auth.uid() and is_approved_uploader())
  with check (owner_id = auth.uid());

drop policy if exists videos_owner_delete on videos;
create policy videos_owner_delete on videos
  for delete using (owner_id = auth.uid() or is_admin());

drop policy if exists videos_staff_all on videos;
create policy videos_staff_all on videos
  for all using (is_staff()) with check (is_staff());

-- An uploader must not be able to self-publish or overwrite a moderator's
-- ruling. Same column-level problem as profiles, same solution.
create or replace function guard_video_status_transitions()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- Trusted, non-browser contexts: the transcode worker and service-role
  -- server actions (auth.uid() is null for the service key), plus migrations.
  -- RLS blocks anonymous callers before this trigger runs — the UPDATE
  -- policies on videos all require auth.uid() — so a null uid here can only be
  -- a caller that already bypasses RLS by design.
  if auth.uid() is null or is_staff() then
    return new;
  end if;

  -- An owner may only move a draft forward into review, start their own
  -- upload, or withdraw their work. Everything else is a moderator transition.
  if new.status is distinct from old.status then
    if not (
      (old.status in ('draft', 'rejected') and new.status = 'pending_review')
      or (old.status in ('draft', 'pending_review', 'published') and new.status = 'removed')
      or (old.status = 'draft' and new.status = 'uploading' and new.owner_id = auth.uid())
    ) then
      raise exception 'Status transition % -> % requires a moderator', old.status, new.status;
    end if;
  end if;

  if new.moderated_by  is distinct from old.moderated_by
     or new.moderated_at is distinct from old.moderated_at
     or new.moderation_note is distinct from old.moderation_note
     or new.view_count is distinct from old.view_count then
    raise exception 'Not permitted to modify moderation or counter columns';
  end if;

  return new;
end;
$fn$;

drop trigger if exists videos_guard_status on videos;
create trigger videos_guard_status
  before update on videos
  for each row execute function guard_video_status_transitions();

-- Stamp published_at exactly once, when a video first goes live.
create or replace function stamp_published_at()
returns trigger
language plpgsql
as $fn$
begin
  if new.status = 'published' and new.published_at is null then
    new.published_at = now();
  end if;
  return new;
end;
$fn$;

drop trigger if exists videos_stamp_published on videos;
create trigger videos_stamp_published
  before insert or update on videos
  for each row execute function stamp_published_at();

-- ---------------------------------------------------------------------------
-- Video join tables and renditions follow the parent video's visibility.
-- ---------------------------------------------------------------------------

drop policy if exists video_categories_read on video_categories;
create policy video_categories_read on video_categories
  for select using (can_read_video(video_id));

drop policy if exists video_categories_write on video_categories;
create policy video_categories_write on video_categories
  for all using (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  )
  with check (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  );

drop policy if exists video_tags_read on video_tags;
create policy video_tags_read on video_tags
  for select using (can_read_video(video_id));

drop policy if exists video_tags_write on video_tags;
create policy video_tags_write on video_tags
  for all using (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  )
  with check (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  );

drop policy if exists video_renditions_read on video_renditions;
create policy video_renditions_read on video_renditions
  for select using (can_read_video(video_id));

drop policy if exists video_renditions_staff_write on video_renditions;
create policy video_renditions_staff_write on video_renditions
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- ingest_jobs - readable by the requester so the upload UI can poll progress.
-- Rows are created by server actions holding the service key, never directly
-- by the browser, so there is no client insert policy.
-- ---------------------------------------------------------------------------

drop policy if exists ingest_jobs_read_own on ingest_jobs;
create policy ingest_jobs_read_own on ingest_jobs
  for select using (requested_by = auth.uid() or is_staff());

drop policy if exists ingest_jobs_staff_write on ingest_jobs;
create policy ingest_jobs_staff_write on ingest_jobs
  for all using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- clips
-- ---------------------------------------------------------------------------

drop policy if exists clips_read on clips;
create policy clips_read on clips
  for select using (can_read_video(source_video_id));

drop policy if exists clips_insert_own on clips;
create policy clips_insert_own on clips
  for insert with check (created_by = auth.uid() and is_approved_uploader());

drop policy if exists clips_modify_own on clips;
create policy clips_modify_own on clips
  for all using (created_by = auth.uid() or is_staff())
  with check (created_by = auth.uid() or is_staff());

-- ---------------------------------------------------------------------------
-- Engagement - a user may only read and write their own rows.
-- ---------------------------------------------------------------------------

drop policy if exists video_votes_read_own on video_votes;
create policy video_votes_read_own on video_votes
  for select using (user_id = auth.uid());

drop policy if exists video_votes_write_own on video_votes;
create policy video_votes_write_own on video_votes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists favorites_own on favorites;
create policy favorites_own on favorites
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Raw view rows are analytics data: staff only. Writes go through
-- record_video_view(), which is SECURITY DEFINER.
drop policy if exists video_views_staff_read on video_views;
create policy video_views_staff_read on video_views
  for select using (is_staff());

-- ---------------------------------------------------------------------------
-- reports - anyone may file one, including logged-out visitors. Only staff
-- may read the queue, so reporters cannot enumerate each other.
-- ---------------------------------------------------------------------------

drop policy if exists reports_insert_anyone on reports;
create policy reports_insert_anyone on reports
  for insert with check (true);

drop policy if exists reports_read_own_or_staff on reports;
create policy reports_read_own_or_staff on reports
  for select using (
    (reporter_id is not null and reporter_id = auth.uid()) or is_staff()
  );

drop policy if exists reports_staff_update on reports;
create policy reports_staff_update on reports
  for update using (is_staff()) with check (is_staff());

-- ---------------------------------------------------------------------------
-- audit_log - append-only from the server, readable by admins.
-- ---------------------------------------------------------------------------

drop policy if exists audit_log_admin_read on audit_log;
create policy audit_log_admin_read on audit_log
  for select using (is_admin());
