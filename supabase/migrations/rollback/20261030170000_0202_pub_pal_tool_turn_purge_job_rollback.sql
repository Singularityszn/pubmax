-- Rollback for 0202: unschedule the database purge of Pub Pal tool turns.
--
-- COST: expired turn rows remain unless a replacement purge is active.
-- Before this rollback, follow the recovery instructions in
-- docs/CRON_PLANE_RUNBOOK.md.
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
