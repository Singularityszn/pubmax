-- 0197: Bind stop actions to the venue in the locked route, not a reusable position.
-- Apply before the application projection change. Public RPC signatures and
-- the 0075 Social Crew boundary wrappers remain unchanged.

alter table public.plan_actions
  add column venue_id text,
  add column route_revision integer;

alter table public.plan_actions
  add constraint plan_actions_venue_identity_shape check (
    (venue_id is null and route_revision is null)
    or (venue_id is not null and venue_id <> '' and route_revision is not null and route_revision >= 1)
  );

-- Only revision one proves that the current stop was present at action time.
-- Revised legacy rows remain unknown. Existing completion history is untouched.
update public.plan_actions action
set venue_id = stop.venue_id, route_revision = plan.route_revision
from public.plans plan, public.plan_stops stop
where plan.id = action.plan_id and plan.route_revision = 1
  and stop.plan_id = plan.id and stop.position = action.stop_position
  and action.type in ('arrived', 'skipped', 'swapped');

create function public.plan_action_capture_venue_identity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.type = 'ending' then
    new.venue_id := null;
    new.route_revision := null;
    return new;
  end if;
  -- The write RPC already locks this row. Taking the same lock also protects
  -- direct service inserts from a concurrent route replacement or proposal.
  select route_revision into new.route_revision
  from public.plans where id = new.plan_id for update;
  select venue_id into new.venue_id
  from public.plan_stops where plan_id = new.plan_id and position = new.stop_position;
  if new.venue_id is null or new.route_revision is null then
    raise exception 'Stop action requires a canonical route venue' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.plan_action_capture_venue_identity() from public, anon, authenticated;
grant execute on function public.plan_action_capture_venue_identity() to service_role;
create trigger plan_action_capture_venue_identity
before insert on public.plan_actions
for each row execute function public.plan_action_capture_venue_identity();

-- The revision-aware overload checks intent under the same route lock.
create or replace function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid,
  p_token_hash text,
  p_action_id uuid,
  p_type text,
  p_stop_position integer,
  p_idempotency_key_hash text,
  p_request_hash text,
  p_created_at timestamptz,
  p_expected_route_revision integer
) returns text
language plpgsql security definer set search_path = ''
as $$
declare actor public.plan_crew_members%rowtype;
declare existing_action public.plan_actions%rowtype;
declare host_id uuid;
declare current_plan public.plans%rowtype;
begin
  if public._social_plan_is_bound(p_plan_id) then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('plan:action:' || p_plan_id::text || ':' || p_idempotency_key_hash, 0));
  select * into current_plan from public.plans where id = p_plan_id for update;
  if not found then return 'not_found'; end if;
  select * into actor from public.plan_crew_members where plan_id = p_plan_id and token_hash = p_token_hash;
  if not found then return 'forbidden'; end if;
  select id into host_id from public.plan_crew_members where plan_id = p_plan_id order by joined_at, id limit 1;
  if not actor.can_collaborate and actor.id <> host_id then return 'forbidden'; end if;
  if p_type = 'swapped' and actor.id <> host_id then return 'forbidden'; end if;
  if p_type not in ('arrived', 'skipped', 'swapped') or p_stop_position not between 0 and 7 then return 'invalid'; end if;

  select * into existing_action from public.plan_actions
  where plan_id = p_plan_id and actor_member_id = actor.id and idempotency_key_hash = p_idempotency_key_hash for update;
  if found then
    if existing_action.request_hash = p_request_hash and existing_action.id = p_action_id then return 'replayed'; end if;
    return 'conflict';
  end if;

  -- An exact replay above stays safe after a route changes. A new write
  -- needs the revision the caller saw. An old caller is safe only on revision 1.
  if coalesce(p_expected_route_revision, 1) <> current_plan.route_revision then return 'conflict'; end if;
  if not exists (select 1 from public.plan_stops where plan_id = p_plan_id and position = p_stop_position) then return 'invalid'; end if;

  insert into public.plan_actions
    (id, plan_id, actor_member_id, type, stop_position, created_at, idempotency_key_hash, request_hash)
  values
    (p_action_id, p_plan_id, actor.id, p_type, p_stop_position, p_created_at, p_idempotency_key_hash, p_request_hash);
  update public.plans set status = 'active' where id = p_plan_id and status in ('draft', 'ready');
  return 'applied';
end;
$$;

revoke all on function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.add_plan_action_idempotent_atomic(uuid,text,uuid,text,integer,text,text,timestamptz,integer) to service_role;

create or replace function public.add_plan_action_idempotent_atomic(
  p_plan_id uuid, p_token_hash text, p_action_id uuid, p_type text,
  p_stop_position integer, p_idempotency_key_hash text, p_request_hash text,
  p_created_at timestamptz
) returns text
language plpgsql security definer set search_path = ''
as $$ begin
  return public.add_plan_action_idempotent_atomic($1,$2,$3,$4,$5,$6,$7,$8,null);
end; $$;

-- Correct both existing inner implementations. Their public wrappers retain
-- their current names, grants and Social Crew refusal. The selected-drink
-- completion snapshot trigger from 0165 continues to run.

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
  arrival_position integer;
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
      where stop.plan_id = p_plan_id and stop.venue_id = action.venue_id
    )
  order by action.created_at, action.id
  limit 1;
  if not found then return 'arrival_required'; end if;
  select position into arrival_position from public.plan_stops
  where plan_id = p_plan_id and venue_id = qualifying_arrival.venue_id;

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
     qualifying_arrival.id, arrival_position,
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
  arrival_position integer;
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
      where stop.plan_id = p_plan_id and stop.venue_id = action.venue_id
    )
  order by action.created_at, action.id
  limit 1;
  if not found then return 'arrival_required'; end if;
  select position into arrival_position from public.plan_stops
  where plan_id = p_plan_id and venue_id = qualifying_arrival.venue_id;

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
     qualifying_arrival.id, arrival_position,
     qualifying_arrival.created_at, p_completed_at);
  return 'completed';
end;
$$;
