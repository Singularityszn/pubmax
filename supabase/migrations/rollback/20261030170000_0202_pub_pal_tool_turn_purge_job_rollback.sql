-- Rollback for 0202: unschedule the database purge of Pub Pal tool turns.
--
-- COST: this removes scheduled deletion of expired turns, including user text.
-- Follow docs/CRON_PLANE_RUNBOOK.md recovery requirements before applying it.
--
-- The pg_cron extension stays installed: another job may use it, and dropping
-- an extension is not this migration's to decide.

do $rollback$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'pubmax-purge-pub-pal-tool-turns';
end
$rollback$;
