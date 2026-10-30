-- Rollback for 0200: unschedule the database purge of Pub Pal tool turns.
--
-- COST: the purge then rests on the Vercel cron route alone. If its
-- vercel.json entry was already removed, put it back FIRST, or expired turn
-- rows (the user's own lines) stay in the table until something deletes them.
-- Every read already refuses an expired row, so nothing is shown, but the
-- retention promise in 0169 is broken until the route runs again.
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
