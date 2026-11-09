-- docs/CRON_PLANE_RUNBOOK.md owns purge scheduling and recovery.
--
-- The captain applies this. On Supabase, pg_cron lives in pg_catalog and its
-- jobs run as the role that scheduled them, so the job runs as postgres, which
-- owns the table. The 0160 index on expires_at serves the deletion predicate.
--
-- A cluster with no pg_cron available (the local proof fixture, a plain
-- PostgreSQL), or with the package installed but not loaded at server start
-- (no shared_preload_libraries entry, so no cron.database_name setting and
-- CREATE EXTENSION fails), gets a NOTICE and no job, rather than a failed
-- migration. The NOTICE text refers to the retired Vercel backstop.
-- See the runbook for the current recovery requirements.
--
-- cron.schedule with a job NAME replaces a job of that name, so applying this
-- twice leaves one job.

do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available on this cluster; the Vercel cron keeps purging pub_pal_tool_turns';
    return;
  end if;
  if current_setting('cron.database_name', true) is null then
    raise notice 'pg_cron is not loaded at server start on this cluster; the Vercel cron keeps purging pub_pal_tool_turns';
    return;
  end if;

  execute 'create extension if not exists pg_cron with schema pg_catalog';

  perform cron.schedule(
    'pubmax-purge-pub-pal-tool-turns',
    '* * * * *',
    $job$delete from public.pub_pal_tool_turns where expires_at < now()$job$
  );
end
$migration$;
