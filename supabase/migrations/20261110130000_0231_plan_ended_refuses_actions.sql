-- 0231: an ended Plan takes no new stop action and no completion.
-- add_plan_action_idempotent_atomic refuses a new action on a completed or abandoned Plan.
-- complete_plan_atomic (both overloads) refuses an abandoned Plan, and a draft or ready Plan after the arrival check.
-- Both answer 'closed'. An idempotent replay of earlier work still answers as before.
-- The memory store in lib/planStore.ts applies the same rule.
begin;

CREATE OR REPLACE FUNCTION public.add_plan_action_idempotent_atomic(p_plan_id uuid, p_token_hash text, p_action_id uuid, p_type text, p_stop_position integer, p_idempotency_key_hash text, p_request_hash text, p_created_at timestamp with time zone, p_expected_route_revision integer DEFAULT NULL::integer, p_venue_id text DEFAULT NULL::text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor public.plan_crew_members%rowtype;
declare existing_action public.plan_actions%rowtype;
declare host_id uuid;
declare current_revision integer;
declare current_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('plan:action:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select route_revision, status into current_revision, current_status from public.plans
    where id = p_plan_id and social_owner_account_id is null for update;
  if not found then return 'not_found'; end if;
  select * into actor from public.plan_crew_members where plan_id = p_plan_id and token_hash = p_token_hash and membership_revoked_at is null for share;
  if not found then return 'forbidden'; end if;
  select id into host_id from public.plan_crew_members where plan_id = p_plan_id and membership_revoked_at is null order by joined_at, id limit 1;
  if not actor.can_collaborate and actor.id <> host_id then return 'forbidden'; end if;
  if p_type = 'swapped' and actor.id <> host_id then return 'forbidden'; end if;
  if p_type not in ('arrived', 'skipped', 'swapped') or p_stop_position not between 0 and 7 then return 'invalid'; end if;

  select * into existing_action from public.plan_actions
  where plan_id = p_plan_id and actor_member_id = actor.id and idempotency_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_action.request_hash = p_request_hash and existing_action.id = p_action_id then return 'replayed'; end if;
    return 'conflict';
  end if;
  -- 0231: an ended Plan takes no new action. A replay of an action it took before it ended still answers above.
  if current_status in ('completed', 'abandoned') then return 'closed'; end if;

  if p_expected_route_revision is not null or p_venue_id is not null then
    if p_expected_route_revision is null or p_expected_route_revision < 1 or nullif(btrim(p_venue_id),'') is null then return 'invalid'; end if;
    if p_expected_route_revision <> current_revision or not exists (
      select 1 from public.plan_stops where plan_id=p_plan_id and position=p_stop_position and venue_id=p_venue_id
    ) then return 'conflict'; end if;
  end if;
  if not exists (select 1 from public.plan_stops where plan_id=p_plan_id and position=p_stop_position) then return 'invalid'; end if;

  insert into public.plan_actions
    (id, plan_id, actor_member_id, type, stop_position, created_at, idempotency_key_hash, request_hash, route_revision, venue_id)
  values
    (p_action_id, p_plan_id, actor.id, p_type, p_stop_position, p_created_at, p_idempotency_key_hash, p_request_hash, p_expected_route_revision, p_venue_id);
  update public.plans set status = 'active' where id = p_plan_id and status in ('draft', 'ready');
  return 'applied';
end;
$function$;

CREATE OR REPLACE FUNCTION public._0075_complete_plan_atomic_8(p_plan_id uuid, p_token_hash text, p_expected_route_revision integer, p_completion_id uuid, p_action_id uuid, p_ending text, p_terminal_venue_id text, p_completed_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if current_plan.status = 'abandoned' then return 'closed'; end if;

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
  -- 0231: the same answer as canTransitionPlannedNight(status, 'completed') in lib/plan.ts.
  if current_plan.status not in ('active', 'ending', 'completed') then return 'closed'; end if;

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
$function$;

CREATE OR REPLACE FUNCTION public._0075_complete_plan_atomic_9(p_plan_id uuid, p_token_hash text, p_expected_route_revision integer, p_completion_id uuid, p_action_id uuid, p_ending text, p_terminal_venue_id text, p_ending_selection jsonb, p_completed_at timestamp with time zone)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  if current_plan.status = 'abandoned' then return 'closed'; end if;

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
  -- 0231: the same answer as canTransitionPlannedNight(status, 'completed') in lib/plan.ts.
  if current_plan.status not in ('active', 'ending', 'completed') then return 'closed'; end if;

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
$function$;

commit;
