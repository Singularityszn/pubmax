-- Rollback for 0226. It deletes every live position that is still shared. It
-- opens no read path. Deploy the application without live location first.
-- The pg_cron extension stays installed: another job may use it.
do $rollback$
begin
  if to_regclass('cron.job') is null then
    return;
  end if;
  perform cron.unschedule(jobid)
  from cron.job
  where jobname = 'pubmax-purge-plan-live-locations';
end
$rollback$;

begin;
drop trigger if exists plan_end_forgets_live_locations on public.plans;
drop trigger if exists plan_seat_end_forgets_live_location on public.plan_crew_members;
drop trigger if exists crew_seat_end_forgets_live_location on public.social_crew_members;
drop function if exists public.plan_live_location(uuid,text,uuid,text,double precision,double precision,integer,timestamptz);
drop function if exists public.plan_live_location_ends_at(timestamptz);
drop function if exists public.forget_plan_live_locations();
drop table if exists public.plan_live_locations;
drop table if exists public.plan_live_location_stops;
commit;
