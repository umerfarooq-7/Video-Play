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
