-- ==========================================================================
-- COMBINED MIGRATION - paste into the Supabase SQL Editor and Run.
-- Safe on a fresh project AND re-runnable on an existing one.
-- ==========================================================================


-- ///////////////// 0001_init.sql /////////////////

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

drop trigger if exists on_auth_user_created on auth;
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

-- ///////////////// 0002_pipeline_and_moderation.sql /////////////////

-- ============================================================================
-- 0002_pipeline_and_moderation.sql
-- Ingest jobs, the promo/clip cutting tool, engagement and moderation.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ingest_jobs - one row per unit of work handed to the transcode worker.
--
-- Covers all three entry points: a browser direct upload, a remote URL import,
-- and a clip cut from an already-published video. The worker claims rows with
-- `claim_ingest_job()` below so several workers can run without double-work.
-- ---------------------------------------------------------------------------

create table if not exists ingest_jobs (
  id             uuid primary key default gen_random_uuid(),
  video_id       uuid not null references videos(id) on delete cascade,
  requested_by   uuid not null references profiles(id) on delete cascade,
  kind           ingest_kind not null,
  status         job_status not null default 'queued',

  -- For kind='remote_url': the URL to fetch. Validated in the app layer
  -- against the SSRF blocklist before it is ever written here.
  source_url     text,
  -- For kind='direct_upload': where the raw upload landed.
  source_path    text,
  -- For kind='clip': the video to cut from, and the cut window.
  clip_source_id uuid references videos(id) on delete set null,
  clip_start_seconds numeric(10,3),
  clip_end_seconds   numeric(10,3),

  progress       int not null default 0,
  attempts       int not null default 0,
  max_attempts   int not null default 3,
  -- Set while a worker holds the job; lets a sweeper reclaim dead workers.
  locked_by      text,
  locked_at      timestamptz,
  error          text,
  started_at     timestamptz,
  finished_at    timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint progress_range check (progress between 0 and 100),
  constraint clip_window_valid check (
    kind <> 'clip'
    or (clip_start_seconds is not null
        and clip_end_seconds is not null
        and clip_end_seconds > clip_start_seconds)
  ),
  constraint source_present check (
    (kind = 'remote_url'    and source_url  is not null) or
    (kind = 'direct_upload' and source_path is not null) or
    (kind = 'clip'          and clip_source_id is not null)
  )
);

create index if not exists ingest_jobs_queue_idx
  on ingest_jobs(status, created_at)
  where status in ('queued', 'running');

create index if not exists ingest_jobs_video_idx on ingest_jobs(video_id, created_at desc);
create index if not exists ingest_jobs_requester_idx on ingest_jobs(requested_by, created_at desc);

drop trigger if exists ingest_jobs_set_updated_at on ingest_jobs;
create trigger ingest_jobs_set_updated_at
  before update on ingest_jobs
  for each row execute function set_updated_at();

-- Atomically hand the oldest queued job to a worker. SKIP LOCKED lets N
-- workers poll the same table without blocking each other.
create or replace function claim_ingest_job(worker_id text)
returns ingest_jobs
language plpgsql
security definer
set search_path = public
as $fn$
declare
  claimed ingest_jobs;
begin
  select * into claimed
  from ingest_jobs
  where status = 'queued' and attempts < max_attempts
  order by created_at
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  update ingest_jobs
  set status     = 'running',
      attempts   = attempts + 1,
      locked_by  = worker_id,
      locked_at  = now(),
      started_at = coalesce(started_at, now())
  where id = claimed.id
  returning * into claimed;

  return claimed;
end;
$fn$;

-- Return jobs whose worker died mid-flight to the queue.
create or replace function reclaim_stalled_ingest_jobs(stale_after interval default '30 minutes')
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  affected int;
begin
  update ingest_jobs
  -- The cast is required: CASE yields text, and Postgres will not implicitly
  -- convert that to the job_status enum here.
  set status = (case
                  when attempts >= max_attempts then 'failed'
                  else 'queued'
                end)::job_status,
      locked_by = null,
      locked_at = null,
      error = case when attempts >= max_attempts
                   then 'Worker stalled and retry budget exhausted'
                   else error end
  where status = 'running'
    and locked_at < now() - stale_after;

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- clips - the promo/cutting tool. A clip is a first-class video row (so it
-- gets the same player, moderation and search treatment) plus a link back to
-- the source and the cut window it came from.
-- ---------------------------------------------------------------------------

create table if not exists clips (
  id              uuid primary key default gen_random_uuid(),
  source_video_id uuid not null references videos(id) on delete cascade,
  output_video_id uuid references videos(id) on delete set null,
  created_by      uuid not null references profiles(id) on delete cascade,
  title           text not null,
  start_seconds   numeric(10,3) not null,
  end_seconds     numeric(10,3) not null,
  -- A muted, looping, poster-sized cut used for hover previews on the grid,
  -- as opposed to a full standalone clip.
  is_promo        boolean not null default false,
  created_at      timestamptz not null default now(),

  constraint clip_window check (end_seconds > start_seconds),
  constraint clip_max_length check (end_seconds - start_seconds <= 600)
);

create index if not exists clips_source_idx on clips(source_video_id);
create index if not exists clips_creator_idx on clips(created_by, created_at desc);

-- ---------------------------------------------------------------------------
-- Engagement
-- ---------------------------------------------------------------------------

create table if not exists video_votes (
  video_id   uuid not null references videos(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  value      smallint not null,
  created_at timestamptz not null default now(),

  primary key (video_id, user_id),
  constraint vote_value check (value in (-1, 1))
);

-- Maintain videos.like_count / dislike_count from the vote table.
create or replace function video_votes_recount()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    update videos
    set like_count    = like_count    + (case when new.value =  1 then 1 else 0 end),
        dislike_count = dislike_count + (case when new.value = -1 then 1 else 0 end)
    where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update videos
    set like_count    = greatest(like_count    - (case when old.value =  1 then 1 else 0 end), 0),
        dislike_count = greatest(dislike_count - (case when old.value = -1 then 1 else 0 end), 0)
    where id = old.video_id;
  elsif tg_op = 'UPDATE' and new.value <> old.value then
    update videos
    set like_count    = greatest(like_count
          + (case when new.value =  1 then 1 else 0 end)
          - (case when old.value =  1 then 1 else 0 end), 0),
        dislike_count = greatest(dislike_count
          + (case when new.value = -1 then 1 else 0 end)
          - (case when old.value = -1 then 1 else 0 end), 0)
    where id = new.video_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists video_votes_recount_trigger on video_votes;
create trigger video_votes_recount_trigger
  after insert or update or delete on video_votes
  for each row execute function video_votes_recount();

create table if not exists favorites (
  user_id    uuid not null references profiles(id) on delete cascade,
  video_id   uuid not null references videos(id) on delete cascade,
  created_at timestamptz not null default now(),

  primary key (user_id, video_id)
);

create index if not exists favorites_user_idx on favorites(user_id, created_at desc);

-- View events. Kept raw for analytics; videos.view_count is the rolled-up
-- counter the grid sorts on. `viewer_hash` is a salted hash of IP+UA, never
-- the address itself, so repeat views can be de-duplicated without storing PII.
create table if not exists video_views (
  id          bigserial primary key,
  video_id    uuid not null references videos(id) on delete cascade,
  user_id     uuid references profiles(id) on delete set null,
  viewer_hash text,
  country     char(2),
  watch_seconds int,
  created_at  timestamptz not null default now()
);

create index if not exists video_views_video_idx on video_views(video_id, created_at desc);
create index if not exists video_views_country_idx on video_views(country, created_at desc);

-- Bump the denormalised counter, rate-limited to one count per viewer per
-- video per hour so a refresh loop cannot inflate the number.
create or replace function record_video_view(
  p_video_id uuid,
  p_viewer_hash text,
  p_country char(2) default null,
  p_user_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if exists (
    select 1 from video_views
    where video_id = p_video_id
      and viewer_hash = p_viewer_hash
      and created_at > now() - interval '1 hour'
  ) then
    return;
  end if;

  insert into video_views (video_id, user_id, viewer_hash, country)
  values (p_video_id, p_user_id, p_viewer_hash, p_country);

  update videos set view_count = view_count + 1 where id = p_video_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- Moderation and takedowns
-- ---------------------------------------------------------------------------

create table if not exists reports (
  id           uuid primary key default gen_random_uuid(),
  video_id     uuid not null references videos(id) on delete cascade,
  reporter_id  uuid references profiles(id) on delete set null,
  -- Anonymous reporters must be accepted: a takedown route that requires an
  -- account is not a usable abuse channel.
  reporter_email text,
  reason       report_reason not null,
  detail       text,
  status       report_status not null default 'open',
  handled_by   uuid references profiles(id) on delete set null,
  handled_at   timestamptz,
  resolution   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Urgent categories sort to the top of the queue.
create index if not exists reports_open_idx
  on reports(status, created_at)
  where status in ('open', 'triaged');

create index if not exists reports_video_idx on reports(video_id, created_at desc);

drop trigger if exists reports_set_updated_at on reports;
create trigger reports_set_updated_at
  before update on reports
  for each row execute function set_updated_at();

-- Append-only trail of every privileged action, for dispute resolution.
create table if not exists audit_log (
  id           bigserial primary key,
  actor_id     uuid references profiles(id) on delete set null,
  action       text not null,          -- 'video.publish', 'uploader.approve'
  entity_type  text not null,          -- 'video', 'profile', 'report'
  entity_id    uuid,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on audit_log(entity_type, entity_id, created_at desc);
create index if not exists audit_log_actor_idx on audit_log(actor_id, created_at desc);

-- ///////////////// 0003_rls.sql /////////////////

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

-- ///////////////// 0004_seed.sql /////////////////

-- ============================================================================
-- 0004_seed.sql - baseline reference data
--
-- Categories are placeholders with neutral names; rename them from the admin
-- dashboard to match the client's taxonomy. Slugs are the URL contract, so
-- change them before launch rather than after (they end up in SEO links).
-- ============================================================================

insert into categories (slug, name, description, sort_order) values
  ('featured',    'Featured',    'Hand-picked by the editorial team.',        10),
  ('new',         'New',         'Most recently published.',                  20),
  ('trending',    'Trending',    'Rising fastest over the last 48 hours.',    30),
  ('most-viewed', 'Most Viewed', 'Highest all-time view count.',              40),
  ('top-rated',   'Top Rated',   'Best like-to-dislike ratio.',               50),
  ('vr-360',      'VR & 360',    'Immersive video for headsets and phones.',  60),
  ('amateur',     'Amateur',     'Independently produced submissions.',       70),
  ('studio',      'Studio',      'Licensed studio productions.',              80),
  ('uk',          'UK',          'Produced in the United Kingdom.',           90),
  ('usa',         'USA',         'Produced in the United States.',           100),
  ('germany',     'Germany',     'Produced in Germany.',                     110)
on conflict (slug) do nothing;

insert into tags (slug, name) values
  ('hd',       'HD'),
  ('4k',       '4K'),
  ('vr',       'VR'),
  ('360',      '360'),
  ('180',      '180'),
  ('vertical', 'Vertical'),
  ('english',  'English'),
  ('german',   'German'),
  ('verified', 'Verified')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Promote the first admin.
--
-- Supabase has no way to create an auth user from SQL safely, so: sign up
-- through the app UI first, then run this with that account's email.
--
--   update profiles set role = 'admin', uploader_status = 'approved'
--   where id = (select id from auth.users where email = 'you@example.com');
--
-- Everything else in the admin dashboard is reachable once one admin exists.
-- ---------------------------------------------------------------------------

-- ///////////////// 0005_promo_metadata.sql /////////////////

-- ============================================================================
-- 0005_promo_metadata.sql
--
-- Metadata the client's existing upload workflow depends on: paysites, models,
-- content classification, and the distinction between a promo clip and the
-- full-length movie it was cut from.
--
-- Additive and idempotent — safe to run on an existing database and safe to
-- re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

do $do$ begin
  create type content_orientation as enum ('straight', 'gay', 'shemale');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type content_heat as enum ('hardcore', 'softcore');
exception when duplicate_object then null;
end $do$;

-- ---------------------------------------------------------------------------
-- paysites - the studio/network a video was sourced from.
--
-- Kept as its own table rather than a free-text column so the same network
-- cannot arrive as "brazzers.com", "Brazzers" and "www.brazzers.com" in three
-- rows, which would wreck both filtering and attribution.
-- ---------------------------------------------------------------------------

create table if not exists paysites (
  id          uuid primary key default gen_random_uuid(),
  domain      citext unique not null,
  name        text not null,
  description text,
  logo_url    text,
  -- Uploaders may propose a new paysite; staff confirm it. Unapproved ones
  -- stay usable so an upload is never blocked waiting on review.
  is_approved boolean not null default false,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),

  -- Bare domain, no scheme and no www.
  constraint paysite_domain_format
    check (domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$')
);

create index if not exists paysites_approved_idx on paysites(is_approved, domain);

-- ---------------------------------------------------------------------------
-- models - performers appearing in a video.
-- ---------------------------------------------------------------------------

create table if not exists models (
  id          uuid primary key default gen_random_uuid(),
  slug        citext unique not null,
  name        text not null,
  bio         text,
  avatar_url  text,
  is_approved boolean not null default false,
  created_by  uuid references profiles(id) on delete set null,
  video_count int not null default 0,
  created_at  timestamptz not null default now(),

  constraint model_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);

create index if not exists models_name_trgm_idx on models using gin (name gin_trgm_ops);
create index if not exists models_count_idx on models(video_count desc);

create table if not exists video_models (
  video_id uuid not null references videos(id) on delete cascade,
  model_id uuid not null references models(id) on delete cascade,
  primary key (video_id, model_id)
);

create index if not exists video_models_model_idx on video_models(model_id);

-- Keep models.video_count honest, the same way tags.usage_count is maintained.
create or replace function models_recount()
returns trigger
language plpgsql
as $fn$
begin
  if tg_op = 'INSERT' then
    update models set video_count = video_count + 1 where id = new.model_id;
  elsif tg_op = 'DELETE' then
    update models set video_count = greatest(video_count - 1, 0) where id = old.model_id;
  end if;
  return null;
end;
$fn$;

drop trigger if exists video_models_recount on video_models;
create trigger video_models_recount
  after insert or delete on video_models
  for each row execute function models_recount();

-- ---------------------------------------------------------------------------
-- New columns on videos
-- ---------------------------------------------------------------------------

alter table videos
  add column if not exists paysite_id uuid references paysites(id) on delete set null,
  add column if not exists content_orientation content_orientation not null default 'straight',
  add column if not exists content_heat content_heat not null default 'hardcore',
  add column if not exists is_exclusive boolean not null default false,
  add column if not exists produced_on date,
  -- Length of the ORIGINAL movie this promo was cut from. Distinct from
  -- duration_seconds, which is the length of the file we actually serve.
  -- Optional: an uploader often will not know it.
  add column if not exists full_duration_seconds int,
  -- True for a full-length source that exists only so promos can be cut from
  -- it. These are never published; only their clips are.
  add column if not exists is_source_only boolean not null default false;

create index if not exists videos_paysite_idx on videos(paysite_id);
create index if not exists videos_orientation_idx
  on videos(content_orientation, published_at desc)
  where status = 'published';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table paysites     enable row level security;
alter table models       enable row level security;
alter table video_models enable row level security;

-- Readable by everyone: they drive public browse pages and the upload form's
-- autocomplete.
drop policy if exists paysites_public_read on paysites;
create policy paysites_public_read on paysites
  for select using (true);

-- Approved uploaders may propose one; only staff may edit or approve.
drop policy if exists paysites_insert_uploader on paysites;
create policy paysites_insert_uploader on paysites
  for insert with check (is_approved_uploader() and not is_approved);

drop policy if exists paysites_staff_write on paysites;
create policy paysites_staff_write on paysites
  for all using (is_staff()) with check (is_staff());

drop policy if exists models_public_read on models;
create policy models_public_read on models
  for select using (true);

drop policy if exists models_insert_uploader on models;
create policy models_insert_uploader on models
  for insert with check (is_approved_uploader() and not is_approved);

drop policy if exists models_staff_write on models;
create policy models_staff_write on models
  for all using (is_staff()) with check (is_staff());

drop policy if exists video_models_read on video_models;
create policy video_models_read on video_models
  for select using (can_read_video(video_id));

drop policy if exists video_models_write on video_models;
create policy video_models_write on video_models
  for all using (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  )
  with check (
    exists (select 1 from videos v
            where v.id = video_id and (v.owner_id = auth.uid() or is_staff()))
  );

-- ---------------------------------------------------------------------------
-- Search: fold model and paysite names into the existing vector so searching a
-- performer or studio name finds their videos.
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
          (select string_agg(m.name, ' ') from video_models vm
             join models m on m.id = vm.model_id where vm.video_id = v.id), '')), 'A')
     || setweight(to_tsvector('english', coalesce(
          (select string_agg(t.name, ' ') from video_tags vt
             join tags t on t.id = vt.tag_id where vt.video_id = v.id), '')), 'B')
     || setweight(to_tsvector('english', coalesce(
          (select string_agg(c.name, ' ') from video_categories vc
             join categories c on c.id = vc.category_id where vc.video_id = v.id), '')), 'B')
     || setweight(to_tsvector('english', coalesce(
          (select p.name from paysites p where p.id = v.paysite_id), '')), 'B')
     || setweight(to_tsvector('english', coalesce(v.description, '')), 'C')
  where v.id = target;
end;
$fn$;

create or replace function video_model_search_trigger()
returns trigger
language plpgsql
as $fn$
begin
  perform videos_refresh_search_vector(coalesce(new.video_id, old.video_id));
  return null;
end;
$fn$;

drop trigger if exists video_models_search_after_write on video_models;
create trigger video_models_search_after_write
  after insert or delete on video_models
  for each row execute function video_model_search_trigger();

-- ///////////////// 0006_discovery.sql /////////////////

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
