-- Rollback loses every private table sign and note. It opens no public read path.
-- Deploy the application without this feature before removing its function.
begin;
drop trigger if exists plan_action_invalidates_table_beacon on public.plan_actions;
drop trigger if exists plan_change_invalidates_table_beacon on public.plans;
drop function if exists public.invalidate_plan_table_beacon();
drop function if exists public.plan_table_beacon(uuid,text,text,text,text,integer,uuid);
drop table if exists public.plan_table_beacons;
drop function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer,text);
create function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid, p_token_hash text, p_action_id uuid, p_type text,
  p_stop_position integer, p_idempotency_key_hash text, p_request_hash text, p_created_at timestamptz
) returns text language plpgsql security definer set search_path='' as $$
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  return public._0075_add_plan_action_idempotent_atomic(p_plan_id,p_token_hash,p_action_id,p_type,p_stop_position,p_idempotency_key_hash,p_request_hash,p_created_at);
end;
$$;
revoke all on function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz) to service_role;
alter table public.plan_actions drop column if exists venue_id;
alter table public.plan_actions drop column if exists route_revision;
commit;
