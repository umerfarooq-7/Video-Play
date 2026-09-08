-- ============================================================================
-- 0007_grants.sql
--
-- Give the PostgREST roles access to the schema.
--
-- Supabase usually applies these grants automatically to objects created in
-- `public`, and the earlier migrations relied on that. It does not always
-- happen — on a project where it did not, every request failed with
--   42501: permission denied for table categories
-- even with a valid service-role key, because the role could not reach the
-- table at all.
--
-- Granting broadly here is the Supabase model, not a hole: table privileges
-- are open and ROW LEVEL SECURITY is the boundary. Migration 0003 enables RLS
-- on every table with deny-by-default policies, so anon still sees only
-- published videos. Without the grant, RLS never even gets consulted — the
-- request is refused one layer earlier.
--
-- Must run after the tables exist, hence its position at the end. The ALTER
-- DEFAULT PRIVILEGES statements cover anything created later.
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
-- Functions matter for the RPC endpoints: claim_ingest_job, record_video_view
-- and the is_staff / is_admin helpers the policies themselves call.
grant all on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Confirm RLS really is on before handing out those grants. If any table were
-- missing it, the grants above would expose it wholesale — better to fail the
-- migration loudly than to open a table quietly.
-- ---------------------------------------------------------------------------

do $do$
declare
  unprotected text;
begin
  select string_agg(c.relname, ', ')
  into unprotected
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relkind = 'r'
    and not c.relrowsecurity;

  if unprotected is not null then
    raise exception 'RLS is not enabled on: %. Run 0003_rls.sql before this.', unprotected;
  end if;
end
$do$;
