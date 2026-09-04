-- ==========================================================================
-- PATCH 0005 - fix reclaim_stalled_ingest_jobs()
--
-- Safe to run on an existing database, and safe to run more than once.
--
-- CAUSE
--   ERROR 42804: column "status" is of type job_status
--                but expression is of type text
--
-- The CASE expression produces `text`, and Postgres will not implicitly cast
-- that to the job_status enum in an UPDATE ... SET. The function therefore
-- threw every time it ran.
--
-- WHY IT WENT UNNOTICED
-- This function only does anything when a worker dies mid-job, so the bug was
-- invisible until one actually did. The consequence is real though: without
-- it, a job whose worker was killed stays 'running' forever, holding its lock,
-- and no other worker will ever pick it up — the video is stuck on
-- "Processing" permanently.
--
-- FIX
-- Cast the CASE result explicitly.
-- ==========================================================================

create or replace function reclaim_stalled_ingest_jobs(stale_after interval default '30 minutes')
returns int
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  affected int;
begin
  update ingest_jobs
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
