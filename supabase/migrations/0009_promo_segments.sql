-- ============================================================================
-- 0009_promo_segments.sql
--
-- Lets a promo be several scenes joined together rather than one continuous
-- window. Picking a single stretch means the preview only ever shows one
-- moment; stitching a few short cuts gives a viewer a sense of the whole
-- video in the same few seconds.
--
-- Additive and idempotent. preview_start_seconds / preview_end_seconds stay
-- for the single-window case and as a fallback for rows written before this.
-- ============================================================================

alter table videos
  -- [{ "start": 12.5, "end": 15.5 }, ...] in playback order.
  add column if not exists preview_segments jsonb;

-- ---------------------------------------------------------------------------
-- Validate the shape here rather than trusting the writer.
--
-- The worker builds an ffmpeg filter graph straight from this column, so a
-- malformed entry becomes a broken command rather than a caught error. A CHECK
-- constraint is the only place that guarantee can actually hold.
-- ---------------------------------------------------------------------------

create or replace function preview_segments_valid(segments jsonb)
returns boolean
language sql
immutable
as $fn$
  select
    segments is null
    or (
      jsonb_typeof(segments) = 'array'
      and jsonb_array_length(segments) between 1 and 10
      -- Every element must be an object with numeric start/end, end after
      -- start, and no single cut longer than 15 seconds.
      and not exists (
        select 1
        from jsonb_array_elements(segments) as s
        where jsonb_typeof(s) <> 'object'
           or jsonb_typeof(s->'start') <> 'number'
           or jsonb_typeof(s->'end') <> 'number'
           or (s->>'end')::numeric <= (s->>'start')::numeric
           or (s->>'start')::numeric < 0
           or (s->>'end')::numeric - (s->>'start')::numeric > 15
      )
      -- And the joined result stays short: this autoplays on every card in a
      -- grid, so total length is bandwidth paid on every page view.
      and (
        select coalesce(sum((s->>'end')::numeric - (s->>'start')::numeric), 0)
        from jsonb_array_elements(segments) as s
      ) <= 30
    );
$fn$;

do $do$ begin
  alter table videos
    add constraint preview_segments_shape check (preview_segments_valid(preview_segments));
exception when duplicate_object then null;
end $do$;
