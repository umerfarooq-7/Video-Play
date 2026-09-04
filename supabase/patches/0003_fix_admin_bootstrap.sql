-- ==========================================================================
-- PATCH 0003 - allow the first admin to be created
--
-- Safe to run on an existing database, and safe to run more than once.
--
-- CAUSE
-- guard_profile_privilege_columns() only let through callers for whom
-- is_admin() was true. is_admin() reads auth.uid(), which is NULL in the SQL
-- Editor, in a migration, and in psql — none of those carry an end-user JWT.
-- So promoting the very first account was impossible: creating an admin
-- required already being an admin.
--
-- FIX
-- Also let the update through when auth.uid() is NULL.
--
-- WHY THAT IS SAFE
-- RLS is what decides whether an UPDATE reaches this trigger at all. The two
-- UPDATE policies on profiles are:
--     profiles_update_own   using (id = auth.uid())
--     profiles_admin_write  using (is_admin())
-- Neither can be satisfied when auth.uid() is NULL, so an anonymous web
-- request is rejected by RLS *before* this trigger ever runs. The only callers
-- that arrive here with a NULL uid are ones that bypass RLS by design:
--   - the SQL Editor / migrations / psql (superuser)
--   - server code holding the service-role key
-- Both are already fully trusted; neither is reachable from a browser.
--
-- !! MAINTENANCE WARNING !!
-- This reasoning depends on profiles keeping RLS enabled and never gaining an
-- UPDATE policy that an anonymous caller can satisfy. If you ever add a
-- permissive UPDATE policy to profiles, revisit this function first — it would
-- otherwise become a privilege-escalation path.
-- ==========================================================================

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

-- --------------------------------------------------------------------------
-- Now promote your account. Replace the email, then run.
-- --------------------------------------------------------------------------

update profiles
set role = 'admin',
    uploader_status = 'approved'
where id = (
  select id from auth.users where email = 'umerfreelance7@gmail.com'
);

-- Confirm it worked (expect one row: admin / approved).
select username, role, uploader_status from profiles where role = 'admin';
