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
