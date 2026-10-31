-- Rollback loses every private table sign and note. It opens no public read path.
-- Deploy the application without this feature before removing its function.
begin;
drop trigger if exists plan_action_invalidates_table_beacon on public.plan_actions;
drop trigger if exists plan_change_invalidates_table_beacon on public.plans;
drop function if exists public.invalidate_plan_table_beacon();
drop function if exists public.plan_table_beacon(uuid,text,text,text,text,integer,uuid);
drop table if exists public.plan_table_beacons;
drop trigger if exists plan_action_stamps_beacon_revision on public.plan_actions;
drop function if exists public.stamp_plan_table_beacon_action();
alter table public.plan_actions drop column if exists route_revision;
commit;
