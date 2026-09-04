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
