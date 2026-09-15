-- ============================================================================
-- 0010_network_promo.sql
--
-- Per-network promotion shown on that network's watch pages: an offer bar
-- above the video and a "download the full movie" link beneath it, both
-- pointing at a join link the admin sets on the network.
--
-- Additive and idempotent.
-- ============================================================================

alter table paysites
  -- Where both the offer bar and the download link send the viewer.
  add column if not exists promo_url     text,
  -- Offer bar text, e.g. "Exclusive offer! Monthly membership now only $17.95".
  -- No bar is shown when this is empty.
  add column if not exists offer_text    text,
  -- Text of the link beneath the player. Falls back to a default when empty.
  add column if not exists download_text text;

-- These are rendered straight into href attributes on public pages, so the
-- scheme is pinned here as well as in the admin form: a javascript: URL would
-- run in every viewer's browser.
do $do$ begin
  alter table paysites
    add constraint paysite_promo_url_http
    check (promo_url is null or promo_url ~* '^https?://');
exception when duplicate_object then null;
end $do$;

do $do$ begin
  alter table paysites
    add constraint paysite_promo_text_length
    check (
      (offer_text is null or char_length(offer_text) <= 200)
      and (download_text is null or char_length(download_text) <= 200)
    );
exception when duplicate_object then null;
end $do$;
