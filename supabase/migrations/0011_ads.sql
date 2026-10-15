-- ============================================================================
-- 0011_ads.sql
--
-- Advertising slots the admin fills in from /admin/ads:
--   * home_grid     - a banner between the videos on the home page, repeated
--                     every N videos (N lives in ad_settings).
--   * under_player  - a banner beneath the video on a watch page.
--   * preroll       - a clip that plays before the video itself.
--
-- A banner is either an image the admin links somewhere, or a snippet an ad
-- network gave them. The snippet is third-party JavaScript, so the only safe
-- place to run it is a sandboxed iframe — see components/ads/AdSlot.tsx.
--
-- Additive and idempotent.
-- ============================================================================

do $do$ begin
  create type ad_placement as enum ('home_grid', 'under_player', 'preroll');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  create type ad_kind as enum ('image', 'html', 'video');
exception when duplicate_object then null;
end $do$;

create table if not exists ads (
  id          uuid primary key default gen_random_uuid(),
  -- Admin-facing label only. Never rendered to a visitor.
  name        text not null,
  placement   ad_placement not null,
  kind        ad_kind not null,

  -- kind = 'image': the creative, and where clicking it sends the viewer.
  image_url   text,
  target_url  text,
  -- kind = 'html': a snippet from an ad network, run inside a sandboxed frame.
  html_code   text,
  -- Creative size in pixels. For an image it reserves the space so the page
  -- does not jump when it loads; for a snippet it is the frame it runs in,
  -- which an iframe cannot work out for itself.
  width       int,
  height      int,
  -- kind = 'video': the pre-roll clip, and how long before Skip appears.
  video_url   text,
  skip_after_seconds int not null default 5,

  is_active   boolean not null default true,
  -- Lowest first. With several ads in one slot, the viewer gets one at random
  -- weighted by nothing — this only decides the order they are listed in.
  sort_order  int not null default 0,
  -- Optional flight window. Null on either side means "no bound that way".
  starts_at   timestamptz,
  ends_at     timestamptz,

  click_count bigint not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint ad_name_length check (char_length(name) between 2 and 80),

  -- These end up in href and src attributes on public pages, so the scheme is
  -- pinned here as well as in the admin form: a javascript: URL pasted into
  -- either would run in every visitor's browser.
  constraint ad_urls_http check (
    (image_url  is null or image_url  ~* '^https?://')
    and (target_url is null or target_url ~* '^https?://')
    and (video_url  is null or video_url  ~* '^https?://')
  ),

  constraint ad_skip_range check (skip_after_seconds between 0 and 60),

  constraint ad_size_range check (
    (width  is null or width  between 40 and 2000)
    and (height is null or height between 40 and 2000)
  ),

  -- A snippet runs in a frame, and a frame with no height is a frame nobody
  -- sees. An image can go without, since the browser works its size out.
  constraint ad_html_needs_size check (kind <> 'html' or height is not null),

  -- Each kind carries its own creative. Without it the slot would render
  -- nothing and the admin would have no idea why.
  constraint ad_has_creative check (
    (kind = 'image' and image_url is not null)
    or (kind = 'html'  and html_code is not null)
    or (kind = 'video' and video_url is not null)
  ),

  -- A pre-roll is a video and nothing else; a banner is never one.
  constraint ad_kind_fits_placement check ((placement = 'preroll') = (kind = 'video')),

  constraint ad_window check (
    starts_at is null or ends_at is null or ends_at > starts_at
  )
);

-- The lookup every public page makes: active ads for one slot, in order.
create index if not exists ads_slot_idx
  on ads (placement, sort_order)
  where is_active;

drop trigger if exists ads_set_updated_at on ads;
create trigger ads_set_updated_at
  before update on ads
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Settings
--
-- One row, enforced by a boolean primary key that may only ever be true. A
-- key/value table would need a cast and a default at every call site; this
-- keeps the spacing a typed integer with a CHECK on it.
-- ---------------------------------------------------------------------------

create table if not exists ad_settings (
  id                  boolean primary key default true,
  -- Show a home-page banner after this many videos. The client asked for 15.
  home_grid_interval  int not null default 15,
  updated_at          timestamptz not null default now(),

  constraint ad_settings_single_row check (id),
  -- Below about 6 the page is more advert than content; above 100 the slot
  -- would never be reached on a short list.
  constraint ad_settings_interval_range check (home_grid_interval between 6 and 100)
);

insert into ad_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists ad_settings_set_updated_at on ad_settings;
create trigger ad_settings_set_updated_at
  before update on ad_settings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Click counting
--
-- SECURITY DEFINER because the visitor clicking is anonymous and must not be
-- able to write to `ads` directly. It takes an id and increments one counter;
-- there is nothing else it can be made to do.
-- ---------------------------------------------------------------------------

create or replace function record_ad_click(p_ad_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  update ads set click_count = click_count + 1 where id = p_ad_id;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table ads         enable row level security;
alter table ad_settings enable row level security;

-- Visitors read live ads. An ad that is switched off, or outside its flight
-- window, is invisible to everyone but staff — so a paused campaign cannot be
-- found by asking the API for it directly.
drop policy if exists ads_public_read on ads;
create policy ads_public_read on ads
  for select using (
    is_staff()
    or (
      is_active
      and (starts_at is null or starts_at <= now())
      and (ends_at   is null or ends_at   >  now())
    )
  );

-- Admin only, not staff: this is the money, and a moderator's job stops at
-- the content.
drop policy if exists ads_admin_write on ads;
create policy ads_admin_write on ads
  for all using (is_admin()) with check (is_admin());

drop policy if exists ad_settings_public_read on ad_settings;
create policy ad_settings_public_read on ad_settings
  for select using (true);

drop policy if exists ad_settings_admin_write on ad_settings;
create policy ad_settings_admin_write on ad_settings
  for all using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Grants
--
-- 0007 sets default privileges for anything created later, which normally
-- covers these. Stated explicitly anyway: when that default does not apply,
-- every request fails with "permission denied for table ads" before RLS is
-- ever consulted, and the cause is not obvious from the error.
-- ---------------------------------------------------------------------------

grant all on table ads, ad_settings to anon, authenticated, service_role;
grant execute on function record_ad_click(uuid) to anon, authenticated, service_role;
