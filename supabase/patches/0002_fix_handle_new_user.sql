-- ==========================================================================
-- PATCH 0002 - fix "Database error saving new user" on signup
--
-- Safe to run on an existing database, and safe to run more than once.
--
-- CAUSE
-- The original handle_new_user() pinned `set search_path = public` and then
-- called gen_random_bytes(), which belongs to the pgcrypto extension. Supabase
-- installs extensions into the `extensions` schema, not `public`, so inside
-- the function that name could not be resolved. The trigger raised, and
-- GoTrue reported it as the generic "Database error saving new user".
--
-- FIX
--   1. No pgcrypto dependency: md5()/random()/clock_timestamp() are core
--      built-ins in pg_catalog and resolve regardless of search_path.
--   2. search_path also includes `extensions` as a belt-and-braces measure,
--      so citext and friends stay reachable.
--   3. The username the person actually typed is now honoured. The old version
--      appended a random suffix unconditionally, so signing up as "umer"
--      produced "umer_a1b2c3". Now a suffix is only added on a real collision.
--   4. country is truncated to 2 chars so an over-long metadata value cannot
--      violate the char(2) column.
-- ==========================================================================

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  base      text;
  candidate text;
  attempt   int := 0;
begin
  -- Prefer the username supplied at signup; fall back to the email local-part.
  base := coalesce(
    nullif(new.raw_user_meta_data->>'username', ''),
    split_part(coalesce(new.email, ''), '@', 1)
  );

  -- Strip anything the username_format CHECK would reject.
  base := regexp_replace(coalesce(base, ''), '[^a-zA-Z0-9_]', '', 'g');

  if length(base) < 3 then
    base := 'user';
  end if;

  -- Leave room for a collision suffix without breaching the 30-char limit.
  base      := left(base, 23);
  candidate := base;

  -- Take the requested name as-is when it is free; only disambiguate if not.
  while exists (select 1 from public.profiles p where p.username = candidate) loop
    attempt := attempt + 1;

    if attempt > 20 then
      -- Pathological contention: fall back to a wider random tail and stop.
      candidate := left(base, 16) || '_' ||
                   substr(md5(random()::text || clock_timestamp()::text), 1, 10);
      exit;
    end if;

    candidate := base || '_' ||
                 substr(md5(random()::text || clock_timestamp()::text), 1, 5);
  end loop;

  insert into public.profiles (id, username, display_name, country)
  values (
    new.id,
    candidate,
    nullif(new.raw_user_meta_data->>'display_name', ''),
    left(nullif(new.raw_user_meta_data->>'country', ''), 2)
  );

  return new;
end;
$fn$;
