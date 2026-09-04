-- ==========================================================================
-- PATCH 0004 - let the ingest pipeline move video status
--
-- Safe to run on an existing database, and safe to run more than once.
--
-- CAUSE
-- Same root cause as patch 0003, in a different trigger.
-- guard_video_status_transitions() only allowed a non-owner transition when
-- is_staff() was true, and is_staff() reads auth.uid(). The service-role key
-- carries no `sub` claim, so auth.uid() is NULL for it and is_staff() returns
-- false. Every pipeline write was therefore rejected:
--
--   importFromUrl   draft      -> processing       (blocked, stuck on 'draft')
--   finalizeUpload  uploading  -> processing       (blocked)
--   the worker      processing -> pending_review   (blocked)
--
-- The last one matters most: the worker would have transcoded a video
-- successfully and then failed to record the result, so nothing would ever
-- have reached the moderation queue.
--
-- FIX
-- Treat a NULL auth.uid() as a trusted server context, exactly as patch 0003
-- does for profiles, and additionally allow an owner to start their own
-- upload (draft -> uploading).
--
-- WHY THAT IS SAFE
-- RLS decides whether an UPDATE reaches this trigger at all. The UPDATE
-- policies on videos are:
--     videos_update_own  using (owner_id = auth.uid() and is_approved_uploader())
--     videos_staff_all   using (is_staff())
-- Both require auth.uid() to be set, so an anonymous caller is rejected by RLS
-- before the trigger runs. The only callers arriving with a NULL uid are ones
-- that bypass RLS by design: the transcode worker and server actions holding
-- the service-role key, and the SQL editor. None is reachable from a browser.
--
-- What is still enforced for ordinary users: an uploader cannot publish their
-- own video, and cannot overwrite a moderator's decision or the view counter.
--
-- !! MAINTENANCE WARNING !!
-- This depends on videos keeping RLS enabled and never gaining an UPDATE
-- policy an anonymous caller can satisfy. Revisit this function first if you
-- ever add one.
-- ==========================================================================

create or replace function guard_video_status_transitions()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  -- Trusted, non-browser contexts: the transcode worker, service-role server
  -- actions, migrations. See the reasoning above.
  if auth.uid() is null or is_staff() then
    return new;
  end if;

  if new.status is distinct from old.status then
    if not (
      -- Owner submits work for review, or withdraws it.
      (old.status in ('draft', 'rejected') and new.status = 'pending_review')
      or (old.status in ('draft', 'pending_review', 'published') and new.status = 'removed')
      -- Owner starts their own direct upload.
      or (old.status = 'draft' and new.status = 'uploading' and new.owner_id = auth.uid())
    ) then
      raise exception 'Status transition % -> % requires a moderator', old.status, new.status;
    end if;
  end if;

  if new.moderated_by is distinct from old.moderated_by
     or new.moderated_at is distinct from old.moderated_at
     or new.moderation_note is distinct from old.moderation_note
     or new.view_count is distinct from old.view_count then
    raise exception 'Not permitted to modify moderation or counter columns';
  end if;

  return new;
end;
$fn$;

-- --------------------------------------------------------------------------
-- Unstick the two videos that were caught by the bug. The queued job will be
-- picked up as soon as a worker runs.
-- --------------------------------------------------------------------------

update videos
set status = 'processing'
where status in ('draft', 'uploading')
  and id in (select video_id from ingest_jobs where status in ('queued', 'running'));

select id, title, status from videos order by created_at desc;
