-- Restore prior completion behavior, including the abandoned-state gap.
-- Keep completed Plans, ending actions, group snapshots and all 0158 wrappers.
begin;

create or replace function public._0075_complete_plan_atomic_8(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_completed_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  actor_id uuid;
  host_id uuid;
  snapshot jsonb;
  qualifying_arrival public.plan_actions%rowtype;
begin
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;

  select id into actor_id from public.plan_crew_members
  where plan_id = p_plan_id and token_hash = p_token_hash;
  if actor_id is null then return 'forbidden'; end if;
  select id into host_id from public.plan_crew_members
  where plan_id = p_plan_id order by joined_at, id limit 1;
  if host_id is null or actor_id <> host_id then return 'forbidden'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;

  if exists (select 1 from public.plan_completions where plan_id = p_plan_id) then
    return 'already_completed';
  end if;

  select * into qualifying_arrival
  from public.plan_actions action
  where action.plan_id = p_plan_id
    and action.type = 'arrived'
    and action.created_at <= p_completed_at
    and exists (
      select 1 from public.plan_stops stop
      where stop.plan_id = p_plan_id and stop.position = action.stop_position
    )
  order by action.created_at, action.id
  limit 1;
  if not found then return 'arrival_required'; end if;

  if p_ending is null or p_ending not in ('food', 'get_home', 'keep_going') then return 'invalid'; end if;
  if p_ending = 'food' and p_terminal_venue_id is null then return 'invalid'; end if;
  if p_terminal_venue_id is not null and not exists (
    select 1 from public.plan_stops
    where plan_id = p_plan_id and venue_id = p_terminal_venue_id
  ) then return 'invalid'; end if;

  select jsonb_agg(
    jsonb_build_object('venueId', stop.venue_id, 'venueName', stop.venue_name, 'position', stop.position)
    order by stop.position
  ) into snapshot
  from public.plan_stops stop where stop.plan_id = p_plan_id;

  insert into public.plan_actions (id, plan_id, actor_member_id, type, ending, created_at)
  values (p_action_id, p_plan_id, actor_id, 'ending', p_ending, p_completed_at);
  update public.plans set status = 'completed', ending = p_ending where id = p_plan_id;
  insert into public.plan_completions
    (id, plan_id, ending, terminal_venue_id, final_pint_drop_id,
     actor_member_id, route_revision, route_snapshot,
     qualifying_arrival_action_id, qualifying_arrival_stop_position,
     qualifying_arrival_at, completed_at)
  values
    (p_completion_id, p_plan_id, p_ending, p_terminal_venue_id, null,
     actor_id::text, current_plan.route_revision, snapshot,
     qualifying_arrival.id, qualifying_arrival.stop_position,
     qualifying_arrival.created_at, p_completed_at);
  return 'completed';
end;
$$;

create or replace function public._0075_complete_plan_atomic_9(
  p_plan_id uuid,
  p_token_hash text,
  p_expected_route_revision integer,
  p_completion_id uuid,
  p_action_id uuid,
  p_ending text,
  p_terminal_venue_id text,
  p_ending_selection jsonb,
  p_completed_at timestamptz
) returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_plan public.plans%rowtype;
  actor_id uuid;
  host_id uuid;
  snapshot jsonb;
  qualifying_arrival public.plan_actions%rowtype;
begin
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;

  select id into actor_id from public.plan_crew_members
  where plan_id = p_plan_id and token_hash = p_token_hash;
  if actor_id is null then return 'forbidden'; end if;
  select id into host_id from public.plan_crew_members
  where plan_id = p_plan_id order by joined_at, id limit 1;
  if host_id is null or actor_id <> host_id then return 'forbidden'; end if;
  if current_plan.route_revision <> p_expected_route_revision then return 'conflict'; end if;

  if exists (select 1 from public.plan_completions where plan_id = p_plan_id) then
    return 'already_completed';
  end if;

  select * into qualifying_arrival
  from public.plan_actions action
  where action.plan_id = p_plan_id
    and action.type = 'arrived'
    and action.created_at <= p_completed_at
    and exists (
      select 1 from public.plan_stops stop
      where stop.plan_id = p_plan_id and stop.position = action.stop_position
    )
  order by action.created_at, action.id
  limit 1;
  if not found then return 'arrival_required'; end if;

  if p_ending is null or p_ending not in ('food', 'get_home', 'keep_going') then return 'invalid'; end if;
  if p_ending = 'food' and p_terminal_venue_id is null then return 'invalid'; end if;
  if p_terminal_venue_id is not null and not exists (
    select 1 from public.plan_stops
    where plan_id = p_plan_id and venue_id = p_terminal_venue_id
  ) then return 'invalid'; end if;
  if p_ending_selection is null or (
    jsonb_typeof(p_ending_selection) <> 'object'
    or p_ending_selection->>'kind' <> p_ending
    or coalesce(p_ending_selection->>'optionId', '') = ''
    or jsonb_typeof(p_ending_selection->'evidenceSnapshot') <> 'object'
    or (p_ending = 'food' and coalesce(p_ending_selection->>'externalPlaceId', '') = '')
    or (p_ending = 'keep_going' and coalesce(p_ending_selection->>'venueId', '') = '')
  ) then return 'invalid'; end if;

  select jsonb_agg(
    jsonb_build_object('venueId', stop.venue_id, 'venueName', stop.venue_name, 'position', stop.position)
    order by stop.position
  ) into snapshot
  from public.plan_stops stop where stop.plan_id = p_plan_id;

  insert into public.plan_actions (id, plan_id, actor_member_id, type, ending, created_at)
  values (p_action_id, p_plan_id, actor_id, 'ending', p_ending, p_completed_at);
  update public.plans set status = 'completed', ending = p_ending where id = p_plan_id;
  insert into public.plan_completions
    (id, plan_id, ending, terminal_venue_id, ending_selection,
     final_pint_drop_id, actor_member_id, route_revision, route_snapshot,
     qualifying_arrival_action_id, qualifying_arrival_stop_position,
     qualifying_arrival_at, completed_at)
  values
    (p_completion_id, p_plan_id, p_ending, p_terminal_venue_id, p_ending_selection,
     null, actor_id::text, current_plan.route_revision, snapshot,
     qualifying_arrival.id, qualifying_arrival.stop_position,
     qualifying_arrival.created_at, p_completed_at);
  return 'completed';
end;
$$;

revoke all on function public._0075_complete_plan_atomic_8(uuid,text,integer,uuid,uuid,text,text,timestamptz),
  public._0075_complete_plan_atomic_9(uuid,text,integer,uuid,uuid,text,text,jsonb,timestamptz)
  from public, anon, authenticated, service_role;

commit;
