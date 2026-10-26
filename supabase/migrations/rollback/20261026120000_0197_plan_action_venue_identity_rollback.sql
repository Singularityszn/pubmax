-- 0197 rollback: Future actions lose venue/revision provenance. Existing action
-- and completion rows remain, but the two new identity columns are discarded.
-- Prior positional completion behavior returns. Roll back the application
-- projection first if that loss is required. No historical positions are rewritten.

create or replace function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_action_id uuid,
  p_type text,
  p_stop_position integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_created_at timestamptz
) returns text
language plpgsql security definer set search_path='' as $$ begin if public._social_plan_is_bound($1) then return 'not_found'; end if; return public._0075_add_plan_action_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8); end $$;

drop function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer);

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

drop trigger if exists plan_action_capture_venue_identity on public.plan_actions;
drop function if exists public.plan_action_capture_venue_identity();
alter table public.plan_actions drop constraint if exists plan_actions_venue_identity_shape;
alter table public.plan_actions drop column if exists venue_id, drop column if exists route_revision;
