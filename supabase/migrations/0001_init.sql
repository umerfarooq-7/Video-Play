-- ============================================================================
-- 0001_init.sql - core schema
-- Postgres 15+ / Supabase. Run in order: 0001 -> 0002 -> 0003.
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "pg_trgm";
create extension if not exists "citext";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $do$ begin
  create type user_role as enum ('viewer', 'uploader', 'moderator', 'admin');
exception when duplicate_object then null;
end $do$;

-- Lifecycle of a request for upload privileges. 'none' = never applied.
do $do$ begin
  create type uploader_status as enum ('none', 'pending', 'approved', 'rejected', 'suspended');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type video_status as enum (
  'draft',           -- row exists, no media yet
  'uploading',       -- bytes in flight (direct upload or remote fetch)
  'processing',      -- transcode / thumbnail generation running
  'pending_review',  -- media ready, awaiting moderator approval
  'published',       -- publicly visible
  'rejected',        -- moderator refused
  'removed',         -- taken down after publication (DMCA, ToS)
  'failed'           -- pipeline error, see ingest_jobs.error
);
exception when duplicate_object then null;
end $do$;

-- How the frame is mapped, so the player knows whether to use the plain HTML5
-- surface or the VR/360 renderer, and how to split stereo pairs.
do $do$ begin
  create type video_projection as enum (
  'flat',
  'eq360_mono',
  'eq360_stereo_tb',   -- top/bottom
  'eq180_mono',
  'eq180_stereo_sbs'   -- side-by-side
);
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type ingest_kind as enum ('direct_upload', 'remote_url', 'clip');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type report_reason as enum (
  'copyright', 'non_consensual', 'csam', 'underage', 'violence',
  'spam', 'wrong_category', 'broken', 'other'
);
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type report_status as enum ('open', 'triaged', 'actioned', 'dismissed');
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- Utility: updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function set_updated_at()
returns trigger
language plpgsql
as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- profiles - 1:1 with auth.users
-- ---------------------------------------------------------------------------

create table if not exists profiles (
  id                uuid primary key references auth.users(id) on delete cascade,
  username          citext unique not null,
  display_name      text,
  bio               text,
  avatar_url        text,
  role              user_role not null default 'viewer',
  uploader_status   uploader_status not null default 'none',
  -- Region the account is associated with; drives default content and locale.
  country           char(2),
  is_banned         boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint username_format check (username ~ '^[a-zA-Z0-9_]{3,30}$')
);

create index if not exists profiles_role_idx on profiles(role);
create index if not exists profiles_uploader_status_idx on profiles(uploader_status);

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function set_updated_at();

-- Auto-create a profile whenever Supabase Auth creates a user. The username is
-- seeded from signup metadata when supplied, else derived from the email
-- local-part, and always given a random suffix so it cannot collide.
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

-- NB: the table is auth.users, not auth. Dropping "on auth" fails with
-- 42P01 because auth is a schema, not a relation.
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- Role helpers. SECURITY DEFINER so RLS policies can read the caller's role
-- without recursing into the policies on profiles itself.
-- ---------------------------------------------------------------------------

create or replace function is_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select role in ('moderator', 'admin') from public.profiles where id = auth.uid()),
    false
  );
$fn$;

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select role = 'admin' from public.profiles where id = auth.uid()),
    false
  );
$fn$;

create or replace function is_approved_uploader()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (select uploader_status = 'approved' and not is_banned
     from public.profiles where id = auth.uid()),
    false
  );
$fn$;

-- ---------------------------------------------------------------------------
-- uploader_applications - admin approval queue for upload privileges
-- ---------------------------------------------------------------------------

create table if not exists uploader_applications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  status          uploader_status not null default 'pending',
  -- Applicant-supplied context: who they are, what they intend to upload, and
  -- their attestation that they hold distribution rights and performer consent.
  statement       text not null,
  site_url        text,
  rights_attested boolean not null default false,
  reviewed_by     uuid references profiles(id) on delete set null,
  reviewed_at     timestamptz,
  review_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- At most one open application per user; re-application allowed after a ruling.
create unique index if not exists uploader_applications_one_pending
  on uploader_applications(user_id)
  where status = 'pending';

create index if not exists uploader_applications_status_idx
  on uploader_applications(status, created_at desc);

drop trigger if exists uploader_applications_set_updated_at on uploader_applications;
create trigger uploader_applications_set_updated_at
  before update on uploader_applications
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Taxonomy
-- ---------------------------------------------------------------------------

create table if not exists categories (
  id            uuid primary key default gen_random_uuid(),
  slug          citext unique not null,
  name          text not null,
  description   text,
  thumbnail_url text,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),

  constraint category_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists categories_active_idx on categories(is_active, sort_order);

create table if not exists tags (
  id          uuid primary key default gen_random_uuid(),
  slug        citext unique not null,
  name        text not null,
  usage_count int not null default 0,
  created_at  timestamptz not null default now(),

  constraint tag_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists tags_usage_idx on tags(usage_count desc);
create index if not exists tags_name_trgm_idx on tags using gin (name gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------

create table if not exists videos (
  id                  uuid primary key default gen_random_uuid(),
  owner_id            uuid not null references profiles(id) on delete cascade,
  slug                citext unique not null,
  title               text not null,
  description         text,
  status              video_status not null default 'draft',
  projection          video_projection not null default 'flat',

  -- Media metadata, filled in by the transcode worker.
  duration_seconds    int,
  width               int,
  height              int,
  size_bytes          bigint,

  -- Storage/CDN indirection. `provider` names the VideoProvider driver that
  -- owns these bytes, so playback URLs can be re-signed per request and the
  -- vendor swapped without touching callers.
  provider            text not null default 'local',
  provider_asset_id   text,
  playback_hls_path   text,
  thumbnail_path      text,
  preview_sprite_path text,
  poster_time_seconds numeric(10,3) default 0,

  -- Geo availability. An empty allowed_countries means "available everywhere
  -- except blocked_countries". ISO 3166-1 alpha-2, e.g. GB / US / DE.
  allowed_countries   char(2)[] not null default '{}',
  blocked_countries   char(2)[] not null default '{}',

  -- Denormalised counters maintained by trigger, for cheap sorting.
  view_count          bigint not null default 0,
  like_count          int not null default 0,
  dislike_count       int not null default 0,

  -- Moderation
  moderated_by        uuid references profiles(id) on delete set null,
  moderated_at        timestamptz,
  moderation_note     text,

  -- Record-keeping attestations captured at submit time.
  rights_attested     boolean not null default false,
  consent_attested    boolean not null default false,

  search_vector       tsvector,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint video_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint published_needs_timestamp
    check (status <> 'published' or published_at is not null)
);

create index if not exists videos_published_idx
  on videos(published_at desc)
  where status = 'published';

create index if not exists videos_owner_idx on videos(owner_id, created_at desc);
create index if not exists videos_status_idx on videos(status, created_at desc);
create index if not exists videos_views_idx on videos(view_count desc) where status = 'published';
create index if not exists videos_search_idx on videos using gin (search_vector);
create index if not exists videos_title_trgm_idx on videos using gin (title gin_trgm_ops);
create index if not exists videos_allowed_idx on videos using gin (allowed_countries);
create index if not exists videos_blocked_idx on videos using gin (blocked_countries);

drop trigger if exists videos_set_updated_at on videos;
create trigger videos_set_updated_at
  before update on videos
  for each row execute function set_updated_at();

create table if not exists video_categories (
  video_id    uuid not null references videos(id) on delete cascade,
  category_id uuid not null references categories(id) on delete cascade,
  primary key (video_id, category_id)
);

create index if not exists video_categories_category_idx on video_categories(category_id);

create table if not exists video_tags (
  video_id uuid not null references videos(id) on delete cascade,
  tag_id   uuid not null references tags(id) on delete cascade,
  primary key (video_id, tag_id)
);

create index if not exists video_tags_tag_idx on video_tags(tag_id);

-- Individual transcoded renditions (240p/480p/720p/1080p), one row each.
create table if not exists video_renditions (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references videos(id) on delete cascade,
  label        text not null,          -- '720p'
  height       int not null,
  bitrate_kbps int,
  codec        text,
  path         text not null,
  size_bytes   bigint,
  created_at   timestamptz not null default now(),

  unique (video_id, label)
);

-- ---------------------------------------------------------------------------
-- Search vector maintenance. Spans title, tags, categories and description so
-- one GIN index serves the whole search box.
-- ---------------------------------------------------------------------------

create or replace function videos_refresh_search_vector(target uuid)
returns void
language plpgsql
as $fn$
begin
  update videos v
  set search_vector =
        setweight(to_tsvector('english', coalesce(v.title, '')), 'A')
     || setweight(to_tsvector('english', coalesce(
          (select string_agg(t.name, ' ') from video_tags vt
             join tags t on t.id = vt.tag_id where vt.video_id = v.id), '')), 'B')
     || setweight(to_tsvector('english', coalesce(
          (select string_agg(c.name, ' ') from video_categories vc
             join categories c on c.id = vc.category_id where vc.video_id = v.id), '')), 'B')
     || setweight(to_tsvector('english', coalesce(v.description, '')), 'C')
  where v.id = target;
end;
$fn$;

create or replace function videos_search_vector_trigger()
returns trigger
language plpgsql
as $fn$
begin
  perform videos_refresh_search_vector(new.id);
  return null;
end;
$fn$;

drop trigger if exists videos_search_after_write on videos;
create trigger videos_search_after_write
  after insert or update of title, description on videos
  for each row execute function videos_search_vector_trigger();

create or replace function video_link_search_trigger()
returns trigger
language plpgsql
as $fn$
begin
  perform videos_refresh_search_vector(coalesce(new.video_id, old.video_id));
  return null;
end;
$fn$;

drop trigger if exists video_tags_search_after_write on video_tags;
create trigger video_tags_search_after_write
  after insert or delete on video_tags
  for each row execute function video_link_search_trigger();

drop trigger if exists video_categories_search_after_write on video_categories;
create trigger video_categories_search_after_write
  after insert or delete on video_categories
  for each row execute function video_link_search_trigger();

-- Keep tags.usage_count honest.
create or replace function tags_recount()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    update tags set usage_count = usage_count + 1 where id = new.tag_id;
  elsif tg_op = 'DELETE' then
    update tags set usage_count = greatest(usage_count - 1, 0) where id = old.tag_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists video_tags_recount on video_tags;
create trigger video_tags_recount
  after insert or delete on video_tags
  for each row execute function tags_recount();
