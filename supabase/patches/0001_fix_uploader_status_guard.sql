-- ==========================================================================
-- PATCH 0001 - fix uploader application flow
--
-- Run this ONLY if you already ran the first version of RUN_ALL.sql.
-- Do NOT re-run RUN_ALL.sql: it is not idempotent and aborts on the first
-- 'create type' because those types already exist. Nothing else changed.
--
-- Problem: the original guard blocked ANY non-admin change to
-- uploader_status, which included a user applying for upload access. The
-- application flow would have failed with 'Not permitted to modify
-- privilege columns'.
--
-- Fix: allow exactly one self-service transition (none/rejected ->
-- pending). Approval, role and is_banned stay admin-only.
--
-- 'create or replace' makes this safe to run more than once.
-- ==========================================================================

create or replace function guard_profile_privilege_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if is_admin() then
    return new;
  end if;

  -- `role` and `is_banned` are never self-editable, full stop.
  if new.role is distinct from old.role
     or new.is_banned is distinct from old.is_banned then
    raise exception 'Not permitted to modify privilege columns';
  end if;

  -- uploader_status is admin-controlled with exactly one exception: a user
  -- may put themselves into 'pending' by applying. That grants no privilege
  -- of its own — only a moderator can move 'pending' to 'approved' — but it
  -- lets the application flow run as the user instead of needing the service
  -- key for what is an ordinary self-service action.
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
