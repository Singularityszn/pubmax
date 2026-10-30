-- The Pub Pal tool-turn purge runs in the database (0200).
-- Until now /api/cron/purge-pub-pal-turns started a Vercel function every
-- minute (1,440 a day) to run one DELETE. This schedules the same DELETE with
-- pg_cron, inside the database, on the same one-minute clock, so the retention
-- promise is unchanged: a turn row is gone within about a minute of its
-- expires_at (two minutes after the user's last line, 0169).
--
-- The captain applies this. On Supabase, pg_cron lives in pg_catalog and its
-- jobs run as the role that scheduled them, so the job runs as postgres, which
-- owns the table. The predicate is the store's own (lib/pubPalToolTurnStore.ts,
-- purgeExpiredRows) and the 0160 index on expires_at serves it.
--
-- A cluster with no pg_cron available (the local proof fixture, a plain
-- PostgreSQL) gets a NOTICE and no job, rather than a failed migration: the
-- Vercel cron route stays in place and keeps purging, so nothing is lost.
-- Remove that route's vercel.json entry only after cron.job_run_details shows
-- this job succeeding (docs/CRON_PLANE_RUNBOOK.md).
--
-- cron.schedule with a job NAME replaces a job of that name, so applying this
-- twice leaves one job.

do $migration$
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    raise notice 'pg_cron is not available on this cluster; the Vercel cron keeps purging pub_pal_tool_turns';
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
